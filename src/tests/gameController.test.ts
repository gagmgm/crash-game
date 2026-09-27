import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../game/core/EventBus';
import { GameClock } from '../game/core/GameClock';
import { RoundTimeline } from '../game/core/RoundTimeline';
import { GameController } from '../game/GameController';
import type { GameEvents } from '../game/gameEvents';
import type { GameSnapshot } from '../network/protocol';
import { createAppStores } from '../store';
import { BetStatus } from '../types/bet';
import { RoundState } from '../types/game';
import { ConnectionStatus } from '../types/network';
import { silentLogger } from '../utils/logger';
import { FakeConnection, makeSnapshot } from './fakeConnection';
import { useFakeClock } from './helpers';

function setup(snapshot: Partial<GameSnapshot> = {}) {
  const connection = new FakeConnection();
  const stores = createAppStores();
  const events = new EventBus<GameEvents>();
  const clock = new GameClock(() => Date.now());
  let id = 0;
  const controller = new GameController({
    connection,
    stores,
    clock,
    timeline: new RoundTimeline(),
    events,
    logger: silentLogger,
    createId: (prefix) => `${prefix}-${++id}`,
    watchVisibility: () => () => {},
  });
  controller.start();
  const snap = connection.lastSent('REQUEST_SNAPSHOT');
  connection.emit({
    type: 'SNAPSHOT',
    serverTimestamp: 1_000,
    requestId: snap?.requestId ?? null,
    snapshot: makeSnapshot(snapshot),
  });
  const ts = { now: 2_000 };
  const at = () => (ts.now += 10);
  return { connection, stores, events, controller, at };
}

type Setup = ReturnType<typeof setup>;

function startRound({ connection, at }: Setup, roundId: string) {
  connection.emit({
    type: 'BETTING_STARTED',
    serverTimestamp: at(),
    roundId,
    bettingEndsAt: at() + 5000,
  });
}

function runRound({ connection, at }: Setup, roundId: string) {
  connection.emit({
    type: 'ROUND_STARTING',
    serverTimestamp: at(),
    roundId,
    startsAt: at() + 1000,
  });
  connection.emit({
    type: 'ROUND_STARTED',
    serverTimestamp: at(),
    roundId,
    startedAt: at(),
    growthRate: 0.00006,
  });
}

function placeAndAccept(s: Setup, roundId: string) {
  s.controller.placeBet();
  const place = s.connection.lastSent('PLACE_BET');
  if (!place) throw new Error('bet not sent');
  s.connection.emit({
    type: 'BET_ACCEPTED',
    serverTimestamp: s.at(),
    requestId: place.requestId,
    roundId,
    betId: 'bet-1',
    amount: place.amount,
  });
  return place;
}

describe('GameController', () => {
  beforeEach(useFakeClock);
  afterEach(() => vi.useRealTimers());

  it('connects, requests a snapshot and restores state from it', () => {
    const s = setup({ recentRounds: [{ roundId: 'round-99', crashMultiplier: 3.2 }] });
    const game = s.stores.game.getState();
    expect(game.connectionStatus).toBe(ConnectionStatus.CONNECTED);
    expect(game.syncing).toBe(false);
    expect(game.roundId).toBe('round-100');
    expect(game.roundState).toBe(RoundState.BETTING);
    expect(game.recentRounds).toHaveLength(1);
    expect(s.stores.player.getState().balance).toBe(100_000);
  });

  it('follows the round lifecycle from server events', () => {
    const s = setup();
    runRound(s, 'round-100');
    expect(s.stores.game.getState().roundState).toBe(RoundState.RUNNING);
    s.connection.emit({
      type: 'ROUND_CRASHED',
      serverTimestamp: s.at(),
      roundId: 'round-100',
      crashMultiplier: 1.87,
      crashedAt: s.at(),
    });
    expect(s.stores.game.getState().roundState).toBe(RoundState.CRASHED);
    expect(s.stores.game.getState().recentRounds[0]).toEqual({
      roundId: 'round-100',
      crashMultiplier: 1.87,
    });
    s.connection.emit({
      type: 'ROUND_FINISHED',
      serverTimestamp: s.at(),
      roundId: 'round-100',
      recentRounds: [{ roundId: 'round-100', crashMultiplier: 1.87 }],
    });
    expect(s.stores.game.getState().roundState).toBe(RoundState.IDLE);
    startRound(s, 'round-101');
    expect(s.stores.game.getState().roundId).toBe('round-101');
    expect(s.stores.game.getState().roundState).toBe(RoundState.BETTING);
  });

  it('ignores a delayed event from a previous round', () => {
    const s = setup();
    runRound(s, 'round-100');
    s.connection.emit({
      type: 'ROUND_CRASHED',
      serverTimestamp: s.at(),
      roundId: 'round-100',
      crashMultiplier: 2,
      crashedAt: s.at(),
    });
    const staleTs = s.at();
    startRound(s, 'round-101');
    runRound(s, 'round-101');
    // Delayed crash of round-100 arrives after round-101 started.
    s.connection.emit({
      type: 'ROUND_CRASHED',
      serverTimestamp: staleTs,
      roundId: 'round-100',
      crashMultiplier: 5,
      crashedAt: staleTs,
    });
    // Unknown older round (never seen) with an old timestamp is also stale.
    s.connection.emit({
      type: 'ROUND_CRASHED',
      serverTimestamp: 1,
      roundId: 'round-050',
      crashMultiplier: 5,
      crashedAt: 1,
    });
    const game = s.stores.game.getState();
    expect(game.roundId).toBe('round-101');
    expect(game.roundState).toBe(RoundState.RUNNING);
  });

  it('ignores duplicate and backwards lifecycle events', () => {
    const s = setup();
    runRound(s, 'round-100');
    s.connection.emit({
      type: 'ROUND_STARTING',
      serverTimestamp: s.at(),
      roundId: 'round-100',
      startsAt: 0,
    });
    s.connection.emit({
      type: 'ROUND_STARTED',
      serverTimestamp: s.at(),
      roundId: 'round-100',
      startedAt: 0,
      growthRate: 0.00006,
    });
    expect(s.stores.game.getState().roundState).toBe(RoundState.RUNNING);
    expect(s.stores.game.getState().roundStartedAt).not.toBe(0);
  });

  it('prevents duplicate bet requests', () => {
    const s = setup();
    expect(s.controller.placeBet().ok).toBe(true);
    expect(s.controller.placeBet().ok).toBe(false);
    expect(s.connection.countSent('PLACE_BET')).toBe(1);
    expect(s.stores.bet.getState().status).toBe(BetStatus.PLACING);
  });

  it('does not bet outside the betting phase or while syncing', () => {
    const s = setup();
    runRound(s, 'round-100');
    expect(s.controller.placeBet().ok).toBe(false);
    const s2 = setup();
    s2.controller.requestSnapshot('test');
    expect(s2.controller.placeBet().reason).toMatch(/Synchroniz/);
  });

  it('only marks ACTIVE after BET_ACCEPTED and balance only from the server', () => {
    const s = setup();
    placeAndAccept(s, 'round-100');
    expect(s.stores.bet.getState().status).toBe(BetStatus.ACTIVE);
    expect(s.stores.player.getState().balance).toBe(100_000);
    s.connection.emit({
      type: 'BALANCE_UPDATED',
      serverTimestamp: s.at(),
      balance: 99_000,
      currency: 'USD',
      version: 1,
    });
    expect(s.stores.player.getState().balance).toBe(99_000);
    // Out-of-order older balance is dropped.
    s.connection.emit({
      type: 'BALANCE_UPDATED',
      serverTimestamp: s.at(),
      balance: 5,
      currency: 'USD',
      version: 0,
    });
    expect(s.stores.player.getState().balance).toBe(99_000);
  });

  it('prevents duplicate cash-out requests and waits for confirmation', () => {
    const s = setup();
    placeAndAccept(s, 'round-100');
    runRound(s, 'round-100');
    expect(s.controller.cashOut().ok).toBe(true);
    expect(s.controller.cashOut().ok).toBe(false);
    expect(s.connection.countSent('CASH_OUT')).toBe(1);
    expect(s.stores.bet.getState().status).toBe(BetStatus.CASHING_OUT);

    const cash = s.connection.lastSent('CASH_OUT');
    const cues: number[] = [];
    s.events.on('cashoutConfirmed', (e) => cues.push(e.multiplier));
    s.connection.emit({
      type: 'CASHOUT_ACCEPTED',
      serverTimestamp: s.at(),
      requestId: cash?.requestId ?? '',
      roundId: 'round-100',
      betId: 'bet-1',
      multiplier: 1.42,
      payout: 1420,
    });
    const bet = s.stores.bet.getState();
    expect(bet.status).toBe(BetStatus.CASHED_OUT);
    expect(bet.cashoutMultiplier).toBe(1.42);
    expect(bet.payout).toBe(1420);
    expect(cues).toEqual([1.42]);
  });

  it('ignores an old cash-out response with a different request id', () => {
    const s = setup();
    placeAndAccept(s, 'round-100');
    runRound(s, 'round-100');
    s.controller.cashOut();
    s.connection.emit({
      type: 'CASHOUT_ACCEPTED',
      serverTimestamp: s.at(),
      requestId: 'cashout-from-long-ago',
      roundId: 'round-100',
      betId: 'bet-1',
      multiplier: 50,
      payout: 50_000,
    });
    expect(s.stores.bet.getState().status).toBe(BetStatus.CASHING_OUT);
  });

  it('marks an active bet LOST on the authoritative crash', () => {
    const s = setup();
    placeAndAccept(s, 'round-100');
    runRound(s, 'round-100');
    s.connection.emit({
      type: 'ROUND_CRASHED',
      serverTimestamp: s.at(),
      roundId: 'round-100',
      crashMultiplier: 1.01,
      crashedAt: s.at(),
    });
    expect(s.stores.bet.getState().status).toBe(BetStatus.LOST);
  });

  it('cash-out rejected because the round crashed ends as LOST', () => {
    const s = setup();
    placeAndAccept(s, 'round-100');
    runRound(s, 'round-100');
    s.controller.cashOut();
    const cash = s.connection.lastSent('CASH_OUT');
    s.connection.emit({
      type: 'ROUND_CRASHED',
      serverTimestamp: s.at(),
      roundId: 'round-100',
      crashMultiplier: 1.3,
      crashedAt: s.at(),
    });
    expect(s.stores.bet.getState().status).toBe(BetStatus.CASHING_OUT);
    s.connection.emit({
      type: 'CASHOUT_REJECTED',
      serverTimestamp: s.at(),
      requestId: cash?.requestId ?? '',
      roundId: 'round-100',
      reason: 'ROUND_CRASHED',
      message: 'too late',
    });
    expect(s.stores.bet.getState().status).toBe(BetStatus.LOST);
  });

  it('ignores a bet response that arrives after a new round started', () => {
    const s = setup();
    s.controller.placeBet();
    const place = s.connection.lastSent('PLACE_BET');
    // Server moved on before we heard back.
    s.connection.emit({
      type: 'ROUND_STARTING',
      serverTimestamp: s.at(),
      roundId: 'round-100',
      startsAt: 0,
    });
    s.connection.emit({
      type: 'ROUND_STARTED',
      serverTimestamp: s.at(),
      roundId: 'round-100',
      startedAt: s.at(),
      growthRate: 0.00006,
    });
    s.connection.emit({
      type: 'ROUND_CRASHED',
      serverTimestamp: s.at(),
      roundId: 'round-100',
      crashMultiplier: 1.1,
      crashedAt: s.at(),
    });
    startRound(s, 'round-101');
    expect(s.stores.bet.getState().status).toBe(BetStatus.NONE);
    expect(s.stores.bet.getState().unresolvedRoundId).toBe('round-100');
    vi.advanceTimersByTime(1);
    expect(s.stores.game.getState().syncing).toBe(true); // asked server about the unresolved bet
    s.connection.emit({
      type: 'BET_ACCEPTED',
      serverTimestamp: s.at(),
      requestId: place?.requestId ?? '',
      roundId: 'round-100',
      betId: 'bet-1',
      amount: 1000,
    });
    expect(s.stores.bet.getState().status).toBe(BetStatus.NONE);
  });

  it('requests a snapshot when a bet response times out', () => {
    const s = setup();
    s.controller.placeBet();
    const before = s.connection.countSent('REQUEST_SNAPSHOT');
    vi.advanceTimersByTime(10_000);
    expect(s.connection.countSent('REQUEST_SNAPSHOT')).toBeGreaterThan(before);
    expect(s.stores.bet.getState().status).toBe(BetStatus.PLACING); // still pending: server decides
  });

  it('reconnects mid-round and resumes from the authoritative snapshot', () => {
    const s = setup();
    placeAndAccept(s, 'round-100');
    runRound(s, 'round-100');
    s.controller.cashOut();

    s.connection.setStatus(ConnectionStatus.RECONNECTING);
    expect(s.stores.game.getState().connectionStatus).toBe(ConnectionStatus.RECONNECTING);
    expect(s.controller.cashOut().ok).toBe(false);

    s.connection.setStatus(ConnectionStatus.CONNECTED);
    expect(s.stores.game.getState().syncing).toBe(true);
    // Events that arrive before the snapshot are superseded by it.
    s.connection.emit({
      type: 'ROUND_CRASHED',
      serverTimestamp: s.at(),
      roundId: 'round-100',
      crashMultiplier: 9,
      crashedAt: s.at(),
    });
    expect(s.stores.game.getState().roundState).toBe(RoundState.RUNNING);

    const req = s.connection.lastSent('REQUEST_SNAPSHOT');
    s.connection.emit({
      type: 'SNAPSHOT',
      serverTimestamp: s.at(),
      requestId: req?.requestId ?? null,
      snapshot: makeSnapshot({
        state: 'RUNNING',
        serverTime: s.at(),
        roundStartedAt: s.at() - 12_000,
        currentMultiplier: 2.1,
        balance: 101_500,
        balanceVersion: 3,
        playerBet: {
          roundId: 'round-100',
          betId: 'bet-1',
          amount: 1000,
          status: 'CASHED_OUT',
          cashoutMultiplier: 2.05,
          payout: 2050,
        },
      }),
    });
    const game = s.stores.game.getState();
    expect(game.syncing).toBe(false);
    expect(game.roundState).toBe(RoundState.RUNNING);
    expect(game.serverMultiplier).toBe(2.1);
    expect(s.stores.bet.getState().status).toBe(BetStatus.CASHED_OUT);
    expect(s.stores.bet.getState().payout).toBe(2050);
    expect(s.stores.player.getState().balance).toBe(101_500);
  });

  it('ignores a snapshot answering a superseded request', () => {
    const s = setup();
    s.controller.requestSnapshot('a');
    const first = s.connection.lastSent('REQUEST_SNAPSHOT');
    s.controller.requestSnapshot('b');
    s.connection.emit({
      type: 'SNAPSHOT',
      serverTimestamp: s.at(),
      requestId: first?.requestId ?? null,
      snapshot: makeSnapshot({ roundId: 'round-999' }),
    });
    expect(s.stores.game.getState().roundId).toBe('round-100');
    expect(s.stores.game.getState().syncing).toBe(true);
  });

  it('publishes throttled display values for React', () => {
    const s = setup();
    runRound(s, 'round-100');
    vi.advanceTimersByTime(250);
    expect(s.stores.game.getState().displayMultiplier).toBeGreaterThanOrEqual(1);
    s.controller.stop();
  });
});

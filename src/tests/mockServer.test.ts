import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gameConfig } from '../config/gameConfig';
import { MockCrashServer } from '../mock/MockCrashServer';
import type { ServerMessage } from '../network/protocol';
import { useFakeClock } from './helpers';

const cfg = gameConfig.mockServer;

function setup() {
  const server = new MockCrashServer({ random: () => 0.5 });
  const received: ServerMessage[] = [];
  const session = server.connect((m) => received.push(m));
  server.start();
  const send = (command: object) => session.receive(JSON.stringify(command));
  const last = <T extends ServerMessage['type']>(type: T) =>
    [...received].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }>;
  return { server, received, send, last };
}

describe('MockCrashServer', () => {
  beforeEach(useFakeClock);
  afterEach(() => vi.useRealTimers());

  it('runs the full round lifecycle and starts the next round', () => {
    const { server, received } = setup();
    server.forceNextCrash(2); // applies to round 2 (round 1 already drew its point)
    expect(received.map((m) => m.type)).toEqual(['CONNECTED', 'BETTING_STARTED']);

    vi.advanceTimersByTime(cfg.bettingDurationMs);
    expect(server.roundState).toBe('STARTING');
    vi.advanceTimersByTime(cfg.startingDurationMs);
    expect(server.roundState).toBe('RUNNING');
    server.forceCrash();
    expect(server.roundState).toBe('CRASHED');
    vi.advanceTimersByTime(cfg.postCrashDelayMs);
    expect(server.roundState).toBe('IDLE');
    vi.advanceTimersByTime(cfg.idleDurationMs);
    expect(server.roundState).toBe('BETTING');
    expect(server.currentRoundId).toBe('round-1002');

    const types = received.map((m) => m.type);
    expect(types).toContain('ROUND_STARTING');
    expect(types).toContain('ROUND_STARTED');
    expect(types).toContain('ROUND_CRASHED');
    expect(types).toContain('ROUND_FINISHED');
  });

  it('crashes exactly at a forced crash point, on time', () => {
    const server = new MockCrashServer({ random: () => 0.5 });
    const received: ServerMessage[] = [];
    server.connect((m) => received.push(m));
    server.forceNextCrash(1.5);
    server.start();
    server.startNextRound(); // skip betting
    server.startNextRound(); // skip starting
    const crashAtMs = Math.log(1.5) / cfg.growthRate;
    vi.advanceTimersByTime(crashAtMs - 50);
    expect(server.roundState).toBe('RUNNING');
    vi.advanceTimersByTime(100);
    expect(server.roundState).toBe('CRASHED');
    const crashed = received.find((m) => m.type === 'ROUND_CRASHED');
    const ticks = received.filter((m) => m.type === 'ROUND_TICK');
    expect(crashed && crashed.type === 'ROUND_CRASHED' && crashed.crashMultiplier).toBe(1.5);
    expect(ticks.every((t) => t.type === 'ROUND_TICK' && t.multiplier < 1.5)).toBe(true);
    server.stop();
  });

  it('never leaks the crash point before the crash', () => {
    const { server } = setup();
    server.startNextRound();
    server.startNextRound();
    vi.advanceTimersByTime(100);
    const snapshot = server.createSnapshot();
    expect(snapshot.state).toBe('RUNNING');
    expect(snapshot.crashMultiplier).toBeNull();
  });

  it('accepts a valid bet, debits balance and rejects duplicates', () => {
    const { server, send, received, last } = setup();
    const roundId = server.currentRoundId;
    send({ type: 'PLACE_BET', requestId: 'r1', roundId, amount: 1000 });
    expect(last('BET_ACCEPTED').requestId).toBe('r1');
    expect(last('BALANCE_UPDATED').balance).toBe(cfg.initialBalance - 1000);

    // Same requestId replayed: identical response, no second debit.
    const before = received.length;
    send({ type: 'PLACE_BET', requestId: 'r1', roundId, amount: 1000 });
    expect(received.length).toBe(before + 2);
    expect(last('BALANCE_UPDATED').balance).toBe(cfg.initialBalance - 1000);

    send({ type: 'PLACE_BET', requestId: 'r2', roundId, amount: 1000 });
    expect(last('BET_REJECTED').reason).toBe('ALREADY_PLACED');
  });

  it('rejects bets outside betting, for wrong rounds and invalid amounts', () => {
    const { server, send, last } = setup();
    const roundId = server.currentRoundId;
    send({ type: 'PLACE_BET', requestId: 'a', roundId: 'round-1', amount: 1000 });
    expect(last('BET_REJECTED').reason).toBe('WRONG_ROUND');
    send({ type: 'PLACE_BET', requestId: 'b', roundId, amount: 1 });
    expect(last('BET_REJECTED').reason).toBe('INVALID_AMOUNT');
    send({ type: 'PLACE_BET', requestId: 'c', roundId, amount: 10.5 });
    expect(last('BET_REJECTED').reason).toBe('INVALID_AMOUNT');
    send({ type: 'PLACE_BET', requestId: 'd', roundId, amount: cfg.initialBalance + 100 });
    expect(last('BET_REJECTED').reason).toMatch(/INVALID_AMOUNT|INSUFFICIENT_FUNDS/);
    server.startNextRound();
    send({ type: 'PLACE_BET', requestId: 'e', roundId, amount: 1000 });
    expect(last('BET_REJECTED').reason).toBe('ROUND_NOT_BETTING');
  });

  it('cashes out at the server multiplier and credits the payout', () => {
    const { server, send, last } = setup();
    const roundId = server.currentRoundId;
    server.clearForcedCrashes();
    send({ type: 'PLACE_BET', requestId: 'r1', roundId, amount: 1000 });
    const betId = last('BET_ACCEPTED').betId;
    server.startNextRound();
    server.startNextRound();
    // Crash point with random=0.5 is 1.94x; cash out at ~1.5x.
    vi.advanceTimersByTime(6_000);
    send({ type: 'CASH_OUT', requestId: 'c1', roundId, betId });
    const accepted = last('CASHOUT_ACCEPTED');
    expect(accepted.multiplier).toBeGreaterThan(1.3);
    expect(accepted.payout).toBe(Math.floor((1000 * Math.round(accepted.multiplier * 100)) / 100));
    expect(last('BALANCE_UPDATED').balance).toBe(cfg.initialBalance - 1000 + accepted.payout);

    send({ type: 'CASH_OUT', requestId: 'c2', roundId, betId });
    expect(last('CASHOUT_REJECTED').reason).toBe('ALREADY_CASHED_OUT');
  });

  it('rejects a cash-out after the crash and settles the bet as lost', () => {
    const { server, send, last } = setup();
    const roundId = server.currentRoundId;
    send({ type: 'PLACE_BET', requestId: 'r1', roundId, amount: 1000 });
    const betId = last('BET_ACCEPTED').betId;
    server.startNextRound();
    server.startNextRound();
    server.forceCrash();
    send({ type: 'CASH_OUT', requestId: 'c1', roundId, betId });
    expect(last('CASHOUT_REJECTED').reason).toBe('ROUND_CRASHED');
    expect(server.createSnapshot().playerBet?.status).toBe('LOST');
  });

  it('answers pings and malformed frames', () => {
    const { send, last } = setup();
    send({ type: 'PING', requestId: 'p1', clientTimestamp: 42 });
    expect(last('PONG').clientTimestamp).toBe(42);
    send({ type: 'WAT' });
    expect(last('ERROR').code).toBe('BAD_REQUEST');
  });
});

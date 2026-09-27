import { describe, expect, it } from 'vitest';
import {
  canCashOut,
  canPlaceBet,
  initialBetState,
  reduceBet,
  type ActionContext,
  type BetState,
} from '../state/betMachine';
import { BetStatus } from '../types/bet';
import { RoundState } from '../types/game';

const limits = { min: 10, max: 100_000 };
const betting: ActionContext = {
  connected: true,
  syncing: false,
  roundState: RoundState.BETTING,
  roundId: 'round-1',
};
const running: ActionContext = { ...betting, roundState: RoundState.RUNNING };

function placed(): BetState {
  return reduceBet(initialBetState, {
    type: 'PLACE_REQUESTED',
    requestId: 'r1',
    roundId: 'round-1',
    amount: 1000,
  });
}

function active(): BetState {
  return reduceBet(placed(), {
    type: 'BET_ACCEPTED',
    requestId: 'r1',
    roundId: 'round-1',
    betId: 'bet-1',
    amount: 1000,
  });
}

function cashingOut(): BetState {
  return reduceBet(active(), { type: 'CASHOUT_REQUESTED', requestId: 'c1' });
}

describe('bet state machine', () => {
  it('NONE -> PLACING -> ACTIVE -> CASHING_OUT -> CASHED_OUT', () => {
    expect(placed().status).toBe(BetStatus.PLACING);
    expect(active().status).toBe(BetStatus.ACTIVE);
    expect(cashingOut().status).toBe(BetStatus.CASHING_OUT);
    const done = reduceBet(cashingOut(), {
      type: 'CASHOUT_ACCEPTED',
      requestId: 'c1',
      roundId: 'round-1',
      betId: 'bet-1',
      multiplier: 2.35,
      payout: 2350,
    });
    expect(done.status).toBe(BetStatus.CASHED_OUT);
    expect(done.cashoutMultiplier).toBe(2.35);
    expect(done.payout).toBe(2350);
    expect(done.lastResult?.outcome).toBe('CASHED_OUT');
  });

  it('ACTIVE -> LOST when the round crashes', () => {
    const lost = reduceBet(active(), { type: 'ROUND_CRASHED', roundId: 'round-1' });
    expect(lost.status).toBe(BetStatus.LOST);
    expect(lost.lastResult?.outcome).toBe('LOST');
  });

  it('keeps a pending cash-out pending when the crash arrives (server decides)', () => {
    const s = cashingOut();
    expect(reduceBet(s, { type: 'ROUND_CRASHED', roundId: 'round-1' })).toBe(s);
  });

  it('PLACING -> REJECTED on BET_REJECTED and allows retry', () => {
    const rejected = reduceBet(placed(), {
      type: 'BET_REJECTED',
      requestId: 'r1',
      reason: 'Insufficient funds',
    });
    expect(rejected.status).toBe(BetStatus.REJECTED);
    expect(rejected.message).toBe('Insufficient funds');
    const retry = reduceBet(rejected, {
      type: 'PLACE_REQUESTED',
      requestId: 'r2',
      roundId: 'round-1',
      amount: 500,
    });
    expect(retry.status).toBe(BetStatus.PLACING);
    expect(retry.requestId).toBe('r2');
  });

  it('prevents duplicate bet requests', () => {
    const s = placed();
    const again = reduceBet(s, {
      type: 'PLACE_REQUESTED',
      requestId: 'r-dup',
      roundId: 'round-1',
      amount: 1000,
    });
    expect(again).toBe(s);
    expect(canPlaceBet(s, betting, 1000, limits, 10_000).ok).toBe(false);
  });

  it('prevents duplicate cash-out requests', () => {
    const s = cashingOut();
    expect(reduceBet(s, { type: 'CASHOUT_REQUESTED', requestId: 'c2' })).toBe(s);
    expect(canCashOut(s, running).ok).toBe(false);
  });

  it('ignores responses with unknown request ids', () => {
    const s = placed();
    expect(
      reduceBet(s, {
        type: 'BET_ACCEPTED',
        requestId: 'other',
        roundId: 'round-1',
        betId: 'x',
        amount: 1,
      }),
    ).toBe(s);
    const c = cashingOut();
    expect(
      reduceBet(c, {
        type: 'CASHOUT_ACCEPTED',
        requestId: 'old',
        roundId: 'round-1',
        betId: 'bet-1',
        multiplier: 5,
        payout: 5000,
      }),
    ).toBe(c);
  });

  it('ignores duplicate BET_ACCEPTED', () => {
    const s = active();
    expect(
      reduceBet(s, {
        type: 'BET_ACCEPTED',
        requestId: 'r1',
        roundId: 'round-1',
        betId: 'bet-1',
        amount: 1000,
      }),
    ).toBe(s);
  });

  it('CASHOUT_REJECTED returns to ACTIVE while running, LOST after crash', () => {
    const back = reduceBet(cashingOut(), {
      type: 'CASHOUT_REJECTED',
      requestId: 'c1',
      reason: 'nope',
      roundRunning: true,
    });
    expect(back.status).toBe(BetStatus.ACTIVE);
    const lost = reduceBet(cashingOut(), {
      type: 'CASHOUT_REJECTED',
      requestId: 'c1',
      reason: 'crashed',
      roundRunning: false,
    });
    expect(lost.status).toBe(BetStatus.LOST);
  });

  it('guards betting in invalid round states and cash-out without a bet', () => {
    expect(canPlaceBet(initialBetState, running, 1000, limits, 10_000).ok).toBe(false);
    expect(
      canPlaceBet(initialBetState, { ...betting, connected: false }, 1000, limits, 1e6).ok,
    ).toBe(false);
    expect(canPlaceBet(initialBetState, { ...betting, syncing: true }, 1000, limits, 1e6).ok).toBe(
      false,
    );
    expect(canPlaceBet(initialBetState, betting, 5, limits, 10_000).ok).toBe(false);
    expect(canPlaceBet(initialBetState, betting, 20_000, limits, 10_000).ok).toBe(false);
    expect(canPlaceBet(initialBetState, betting, 1000, limits, 10_000).ok).toBe(true);
    expect(canCashOut(initialBetState, running).ok).toBe(false);
    expect(canCashOut(active(), betting).ok).toBe(false);
    expect(canCashOut(active(), running).ok).toBe(true);
  });

  it('resets on a new round and remembers an unresolved live bet', () => {
    const lost = reduceBet(active(), { type: 'ROUND_CRASHED', roundId: 'round-1' });
    const next = reduceBet(lost, { type: 'NEW_ROUND', roundId: 'round-2' });
    expect(next.status).toBe(BetStatus.NONE);
    expect(next.lastResult?.outcome).toBe('LOST');
    expect(next.unresolvedRoundId).toBeNull();

    const missed = reduceBet(cashingOut(), { type: 'NEW_ROUND', roundId: 'round-2' });
    expect(missed.status).toBe(BetStatus.NONE);
    expect(missed.unresolvedRoundId).toBe('round-1');
  });

  it('restores from snapshot authoritatively', () => {
    const restored = reduceBet(cashingOut(), {
      type: 'SNAPSHOT',
      roundId: 'round-1',
      playerBet: {
        roundId: 'round-1',
        betId: 'bet-1',
        amount: 1000,
        status: 'CASHED_OUT',
        cashoutMultiplier: 1.8,
        payout: 1800,
      },
      lastSettledBet: null,
    });
    expect(restored.status).toBe(BetStatus.CASHED_OUT);
    expect(restored.payout).toBe(1800);

    const noRecord = reduceBet(placed(), {
      type: 'SNAPSHOT',
      roundId: 'round-1',
      playerBet: null,
      lastSettledBet: null,
    });
    expect(noRecord.status).toBe(BetStatus.NONE);
    expect(noRecord.message).toMatch(/no record/);

    const resolved = reduceBet(cashingOut(), {
      type: 'SNAPSHOT',
      roundId: 'round-2',
      playerBet: null,
      lastSettledBet: {
        roundId: 'round-1',
        betId: 'bet-1',
        amount: 1000,
        status: 'LOST',
        cashoutMultiplier: null,
        payout: null,
      },
    });
    expect(resolved.status).toBe(BetStatus.NONE);
    expect(resolved.unresolvedRoundId).toBeNull();
    expect(resolved.lastResult?.outcome).toBe('LOST');
  });
});

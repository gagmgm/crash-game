import { describe, expect, it } from 'vitest';
import { RoundTimeline, createTimelineSample } from '../game/core/RoundTimeline';
import type { GameSnapshot } from '../network/protocol';
import { multiplierAt } from '../utils/math';

const RATE = 0.00006;
const opts = { minTickLeadMs: 400, tickLeadMarginMs: 300 };

describe('RoundTimeline', () => {
  it('derives the multiplier from server time, independent of frame rate', () => {
    const t = new RoundTimeline(opts);
    t.setRunning('round-1', 10_000, RATE, 10_000);
    const out = createTimelineSample();
    // With ticks keeping up, display follows the curve.
    t.applyTick(4_900, multiplierAt(4_900, RATE));
    t.sample(15_000, out);
    expect(out.multiplier).toBeCloseTo(multiplierAt(5_000, RATE), 9);
    expect(out.stalled).toBe(false);
  });

  it('does not run far ahead of the last server tick (e.g. during a disconnect)', () => {
    const t = new RoundTimeline(opts);
    t.setRunning('round-1', 0, RATE, 0);
    t.applyTick(2_000, multiplierAt(2_000, RATE));
    const out = t.sample(60_000);
    expect(out.elapsedMs).toBe(2_400);
    expect(out.stalled).toBe(true);
  });

  it('allows more lead on high-latency links', () => {
    const t = new RoundTimeline(opts);
    t.setLatency(2_000);
    t.setRunning('round-1', 0, RATE, 0);
    t.applyTick(2_000, multiplierAt(2_000, RATE));
    expect(t.sample(60_000).elapsedMs).toBe(3_300);
  });

  it('never displays less than the authoritative tick', () => {
    const t = new RoundTimeline(opts);
    t.setRunning('round-1', 0, RATE, 0);
    t.applyTick(5_000, 1.5);
    const out = t.sample(100); // local clock behind
    expect(out.multiplier).toBeCloseTo(1.5, 9);
  });

  it('shows the authoritative crash multiplier after the crash', () => {
    const t = new RoundTimeline(opts);
    t.setRunning('round-1', 0, RATE, 0);
    t.setCrashed('round-1', 2.47, 15_000);
    const out = t.sample(15_500);
    expect(out.phase).toBe('CRASHED');
    expect(out.multiplier).toBe(2.47);
    expect(out.msSinceCrash).toBe(500);
  });

  it('computes betting countdown', () => {
    const t = new RoundTimeline(opts);
    t.setBetting('round-2', 5_000, 0);
    const out = t.sample(1_500);
    expect(out.countdownMs).toBe(3_500);
    expect(out.countdownTotalMs).toBe(5_000);
  });

  it('restores a running round from a snapshot and continues from server state', () => {
    const t = new RoundTimeline(opts);
    const snapshot: GameSnapshot = {
      roundId: 'round-7',
      state: 'RUNNING',
      serverTime: 20_000,
      bettingEndsAt: 5_000,
      startsAt: 6_000,
      roundStartedAt: 6_000,
      growthRate: RATE,
      currentMultiplier: 2.31,
      crashMultiplier: null,
      crashedAt: null,
      playerBet: null,
      lastSettledBet: null,
      balance: 0,
      balanceVersion: 0,
      currency: 'USD',
      recentRounds: [],
      betLimits: { min: 1, max: 2 },
    };
    t.restore(snapshot);
    const out = t.sample(20_100);
    expect(out.phase).toBe('RUNNING');
    expect(out.roundId).toBe('round-7');
    expect(out.multiplier).toBeCloseTo(multiplierAt(14_100, RATE), 9);
  });
});

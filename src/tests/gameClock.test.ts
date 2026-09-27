import { describe, expect, it } from 'vitest';
import { GameClock } from '../game/core/GameClock';

function manualClock() {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('GameClock', () => {
  it('estimates server time from ping samples (symmetric latency)', () => {
    const local = manualClock();
    const clock = new GameClock(local.now);
    // Server is 50_000ms ahead; 100ms each way.
    const sent = local.now();
    local.advance(200);
    clock.addPingSample(sent, sent + 50_000 + 100, local.now());
    expect(clock.rttMs).toBe(200);
    expect(clock.serverNow()).toBeCloseTo(local.now() + 50_000, 6);
  });

  it('prefers the lowest-RTT sample', () => {
    const local = manualClock();
    const clock = new GameClock(local.now);
    clock.addPingSample(0, 10_000 + 400, 1000); // noisy, rtt 1000, asymmetric
    clock.addPingSample(1000, 11_000 + 10, 1020); // rtt 20
    expect(clock.targetOffset).toBe(10_000);
  });

  it('slews small corrections and never runs backwards', () => {
    const local = manualClock();
    const clock = new GameClock(local.now);
    clock.addPingSample(1000, 6000, 1000); // offset 5000
    let previous = clock.serverNow();
    // New, better sample says offset is 5200ms lower... then 200 ms lower.
    clock.addPingSample(1000, 1000 + 4800, 1000);
    for (let i = 0; i < 100; i += 1) {
      local.advance(16);
      const now = clock.serverNow();
      expect(now).toBeGreaterThan(previous);
      previous = now;
    }
  });

  it('computes round elapsed time on the server clock', () => {
    const local = manualClock();
    const clock = new GameClock(local.now);
    clock.addPingSample(1000, 101_000, 1000);
    expect(clock.roundElapsed(100_500)).toBeCloseTo(500, 6);
  });

  it('uses coarse server timestamps only until pinged', () => {
    const local = manualClock();
    const clock = new GameClock(local.now);
    clock.observeServerTimestamp(5000, 1000);
    clock.observeServerTimestamp(5100, 1000); // less delayed message -> better estimate
    expect(clock.targetOffset).toBe(4100);
    clock.addPingSample(1000, 5000, 1000);
    clock.observeServerTimestamp(99_999, 1000);
    expect(clock.targetOffset).toBe(4000);
  });
});

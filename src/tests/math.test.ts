import { describe, expect, it } from 'vitest';
import {
  damp,
  elapsedForMultiplier,
  floorMultiplier,
  formatMultiplier,
  multiplierAt,
  niceStep,
} from '../utils/math';

const RATE = 0.00006;

describe('multiplier/timing math', () => {
  it('starts at 1x and grows exponentially with time', () => {
    expect(multiplierAt(0, RATE)).toBe(1);
    expect(multiplierAt(-100, RATE)).toBe(1);
    expect(multiplierAt(10_000, RATE)).toBeCloseTo(Math.exp(0.6), 10);
  });

  it('inverts cleanly', () => {
    for (const m of [1.01, 2, 10, 100]) {
      expect(multiplierAt(elapsedForMultiplier(m, RATE), RATE)).toBeCloseTo(m, 9);
    }
    expect(elapsedForMultiplier(1, RATE)).toBe(0);
  });

  it('floors multipliers for display and never rounds up', () => {
    expect(floorMultiplier(2.349999)).toBe(2.34);
    expect(floorMultiplier(2.35)).toBe(2.35);
    expect(formatMultiplier(1)).toBe('1.00x');
    expect(formatMultiplier(10.529)).toBe('10.52x');
  });

  it('is frame-rate independent: 60 steps at 60fps equals 30 steps at 30fps', () => {
    let a = 0;
    for (let i = 0; i < 60; i += 1) a = damp(a, 100, 4, 1000 / 60);
    let b = 0;
    for (let i = 0; i < 30; i += 1) b = damp(b, 100, 4, 1000 / 30);
    let c = 0;
    for (let i = 0; i < 120; i += 1) c = damp(c, 100, 4, 1000 / 120);
    expect(a).toBeCloseTo(b, 6);
    expect(a).toBeCloseTo(c, 6);
  });

  it('display progression depends only on time, not frame count', () => {
    const at = (fps: number, durationMs: number) => {
      const frames = Math.round((durationMs / 1000) * fps);
      let t = 0;
      let m = 1;
      for (let i = 0; i < frames; i += 1) {
        t += 1000 / fps;
        m = multiplierAt(t, RATE);
      }
      return m;
    };
    expect(at(30, 5000)).toBeCloseTo(at(144, 5000), 6);
  });

  it('chooses nice axis steps', () => {
    expect(niceStep(1, 5)).toBe(0.2);
    expect(niceStep(9, 5)).toBe(2);
    expect(niceStep(99, 5)).toBe(20);
    expect(niceStep(12_000, 6)).toBe(2000);
  });
});

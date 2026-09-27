import { describe, expect, it } from 'vitest';
import { createTimelineSample } from '../game/core/RoundTimeline';
import { sceneForSample } from '../game/core/SceneManager';
import { RoundState } from '../types/game';

describe('phase -> scene mapping', () => {
  it('maps authoritative phases to scenes', () => {
    const s = createTimelineSample();
    const at = (phase: RoundState, crashMultiplier: number | null = null) =>
      sceneForSample({ ...s, phase, crashMultiplier });
    expect(at(RoundState.IDLE)).toBe('betting');
    expect(at(RoundState.BETTING)).toBe('betting');
    expect(at(RoundState.STARTING)).toBe('betting');
    expect(at(RoundState.RUNNING)).toBe('running');
    expect(at(RoundState.CRASHED, 2)).toBe('crashed');
    expect(at(RoundState.IDLE, 2)).toBe('crashed');
  });
});

import { describe, expect, it } from 'vitest';
import { canTransitionRound, classifyRoundTransition } from '../state/roundMachine';
import { RoundState } from '../types/game';

describe('round state machine', () => {
  it('allows the normal lifecycle', () => {
    expect(canTransitionRound(RoundState.IDLE, RoundState.BETTING)).toBe(true);
    expect(canTransitionRound(RoundState.BETTING, RoundState.STARTING)).toBe(true);
    expect(canTransitionRound(RoundState.STARTING, RoundState.RUNNING)).toBe(true);
    expect(canTransitionRound(RoundState.RUNNING, RoundState.CRASHED)).toBe(true);
    expect(canTransitionRound(RoundState.CRASHED, RoundState.IDLE)).toBe(true);
  });

  it('forbids invalid transitions', () => {
    expect(canTransitionRound(RoundState.BETTING, RoundState.CRASHED)).toBe(false);
    expect(canTransitionRound(RoundState.RUNNING, RoundState.BETTING)).toBe(false);
    expect(canTransitionRound(RoundState.IDLE, RoundState.RUNNING)).toBe(false);
  });

  it('classifies events within a round', () => {
    expect(classifyRoundTransition(RoundState.BETTING, RoundState.STARTING)).toBe('advance');
    expect(classifyRoundTransition(RoundState.RUNNING, RoundState.RUNNING)).toBe('duplicate');
    expect(classifyRoundTransition(RoundState.CRASHED, RoundState.RUNNING)).toBe('stale');
    expect(classifyRoundTransition(RoundState.IDLE, RoundState.CRASHED)).toBe('stale');
    // Missed ROUND_STARTING: forward jump is still authoritative.
    expect(classifyRoundTransition(RoundState.BETTING, RoundState.RUNNING)).toBe('skip');
  });
});

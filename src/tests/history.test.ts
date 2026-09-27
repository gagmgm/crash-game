import { describe, expect, it } from 'vitest';
import { addRoundResult, normalizeHistory } from '../store/history';

describe('round history', () => {
  it('prepends new results and caps length', () => {
    let history = [] as ReturnType<typeof addRoundResult>;
    for (let i = 0; i < 25; i += 1) {
      history = addRoundResult(history, { roundId: `round-${i}`, crashMultiplier: 1 + i }, 20);
    }
    expect(history).toHaveLength(20);
    expect(history[0]?.roundId).toBe('round-24');
    expect(history[19]?.roundId).toBe('round-5');
  });

  it('ignores duplicate results for the same round', () => {
    const h1 = addRoundResult([], { roundId: 'round-1', crashMultiplier: 2 }, 20);
    const h2 = addRoundResult(h1, { roundId: 'round-1', crashMultiplier: 2 }, 20);
    expect(h2).toBe(h1);
  });

  it('normalizes server lists', () => {
    const out = normalizeHistory(
      [
        { roundId: 'a', crashMultiplier: 1 },
        { roundId: 'a', crashMultiplier: 1 },
        { roundId: 'b', crashMultiplier: 3 },
      ],
      20,
    );
    expect(out.map((r) => r.roundId)).toEqual(['a', 'b']);
  });
});

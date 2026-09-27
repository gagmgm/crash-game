import type { RoundResult } from '../types/game';

/** Adds a server-reported result to the front of the history, deduplicated by roundId. */
export function addRoundResult(
  history: readonly RoundResult[],
  result: RoundResult,
  maxLength: number,
): RoundResult[] {
  if (history.some((entry) => entry.roundId === result.roundId)) return history as RoundResult[];
  return [result, ...history].slice(0, maxLength);
}

export function normalizeHistory(
  history: readonly RoundResult[],
  maxLength: number,
): RoundResult[] {
  const seen = new Set<string>();
  const out: RoundResult[] = [];
  for (const entry of history) {
    if (seen.has(entry.roundId)) continue;
    seen.add(entry.roundId);
    out.push(entry);
    if (out.length >= maxLength) break;
  }
  return out;
}

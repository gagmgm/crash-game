import { RoundState } from '../types/game';

/** Allowed single-step transitions of the round lifecycle. */
export const ROUND_TRANSITIONS: Readonly<Record<RoundState, readonly RoundState[]>> = {
  IDLE: [RoundState.BETTING],
  BETTING: [RoundState.STARTING],
  STARTING: [RoundState.RUNNING],
  RUNNING: [RoundState.CRASHED],
  CRASHED: [RoundState.IDLE, RoundState.BETTING],
};

/** Position of each state inside a single round; IDLE is the post-round terminal state. */
const ORDER_IN_ROUND: Readonly<Record<RoundState, number>> = {
  BETTING: 1,
  STARTING: 2,
  RUNNING: 3,
  CRASHED: 4,
  IDLE: 5,
};

export function canTransitionRound(from: RoundState, to: RoundState): boolean {
  return ROUND_TRANSITIONS[from].includes(to);
}

/**
 * How an event for the *current* round relates to the local state:
 * - advance: normal next step
 * - skip: forward jump (messages were missed); still authoritative, apply it
 * - duplicate: same state again, ignore
 * - stale: moves backwards, ignore
 */
export type RoundTransitionKind = 'advance' | 'skip' | 'duplicate' | 'stale';

export function classifyRoundTransition(from: RoundState, to: RoundState): RoundTransitionKind {
  if (from === to) return 'duplicate';
  if (canTransitionRound(from, to)) return 'advance';
  return ORDER_IN_ROUND[to] > ORDER_IN_ROUND[from] ? 'skip' : 'stale';
}

export function isRoundInProgress(state: RoundState): boolean {
  return state === RoundState.STARTING || state === RoundState.RUNNING;
}

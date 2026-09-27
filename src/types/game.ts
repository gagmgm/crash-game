/** Authoritative round lifecycle. Only server messages move a round between these states. */
export const RoundState = {
  IDLE: 'IDLE',
  BETTING: 'BETTING',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  CRASHED: 'CRASHED',
} as const;
export type RoundState = (typeof RoundState)[keyof typeof RoundState];

export const ROUND_STATES: readonly RoundState[] = Object.values(RoundState);

export interface RoundResult {
  roundId: string;
  crashMultiplier: number;
}

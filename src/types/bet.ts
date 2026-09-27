import type { MinorUnits } from '../utils/money';

/** Client-side view of the player's bet. Transitions are driven by server responses. */
export const BetStatus = {
  NONE: 'NONE',
  PLACING: 'PLACING',
  ACTIVE: 'ACTIVE',
  CASHING_OUT: 'CASHING_OUT',
  CASHED_OUT: 'CASHED_OUT',
  LOST: 'LOST',
  REJECTED: 'REJECTED',
} as const;
export type BetStatus = (typeof BetStatus)[keyof typeof BetStatus];

export interface BetLimits {
  min: MinorUnits;
  max: MinorUnits;
}

/** A settled outcome kept for display after the round moves on. */
export interface BetResult {
  roundId: string;
  outcome: 'CASHED_OUT' | 'LOST';
  amount: MinorUnits;
  cashoutMultiplier: number | null;
  payout: MinorUnits | null;
}

/** Visual cues from GameController to the renderer. */
export interface GameEvents {
  /** The server confirmed the player's cash-out; show a marker on the curve. */
  cashoutConfirmed: { roundId: string; multiplier: number };
  /** State was rebuilt from a snapshot or after a hidden tab; animations should snap. */
  resynced: { reason: string };
}

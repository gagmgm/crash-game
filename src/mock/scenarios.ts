/**
 * DEVELOPMENT FIXTURES ONLY.
 * Forced crash points for testing the client. A production backend must generate crash
 * points server-side with a provably fair scheme; nothing here is suitable for real money.
 */
export interface CrashScenario {
  id: string;
  label: string;
  /** Crash points applied to the next rounds, in order. */
  crashPoints: number[];
}

export const FORCED_CRASH_PRESETS = [1.01, 1.1, 1.5, 2, 5, 10, 50, 100] as const;

export const CRASH_SCENARIOS: readonly CrashScenario[] = [
  ...FORCED_CRASH_PRESETS.map((point) => ({
    id: `crash-${point.toFixed(2)}`,
    label: `${point.toFixed(2)}x`,
    crashPoints: [point],
  })),
  { id: 'instant-streak', label: 'Instant streak (3x 1.01)', crashPoints: [1.01, 1.01, 1.01] },
  { id: 'mixed', label: 'Mixed (1.5, 3, 1.1, 12)', crashPoints: [1.5, 3, 1.1, 12] },
  { id: 'long-flight', label: 'Long flight (250x)', crashPoints: [250] },
];

export function findScenario(id: string): CrashScenario | undefined {
  return CRASH_SCENARIOS.find((scenario) => scenario.id === id);
}

/**
 * Dev-only random crash point with a ~3% instant-crash rate.
 * NOT provably fair, NOT for production use.
 */
export function devRandomCrashPoint(random: () => number, max: number): number {
  const houseEdge = 0.03;
  const u = random();
  if (u < houseEdge) return 1;
  const raw = Math.floor((100 * (1 - houseEdge)) / (1 - u)) / 100;
  return Math.min(max, Math.max(1, raw));
}

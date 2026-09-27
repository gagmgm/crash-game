export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Frame-rate independent exponential smoothing: moves `current` toward `target`
 * so that the result is the same at 30, 60 or 120 FPS for the same elapsed time.
 */
export function damp(current: number, target: number, lambda: number, dtMs: number): number {
  return lerp(current, target, 1 - Math.exp((-lambda * dtMs) / 1000));
}

/** Shortest-path angular damping. */
export function dampAngle(current: number, target: number, lambda: number, dtMs: number): number {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp((-lambda * dtMs) / 1000));
}

/**
 * Continuous growth curve shared by server and client: m(t) = e^(rate * t).
 * The rate is sent by the server with each round so the client never hardcodes it.
 */
export function multiplierAt(elapsedMs: number, growthRate: number): number {
  if (elapsedMs <= 0) return 1;
  return Math.exp(growthRate * elapsedMs);
}

/** Inverse of multiplierAt. */
export function elapsedForMultiplier(multiplier: number, growthRate: number): number {
  if (multiplier <= 1) return 0;
  return Math.log(multiplier) / growthRate;
}

/** Truncates to 2 decimals the way crash multipliers are displayed/settled (never rounds up). */
export function floorMultiplier(multiplier: number): number {
  return Math.floor(multiplier * 100 + 1e-9) / 100;
}

export function formatMultiplier(multiplier: number): string {
  return `${floorMultiplier(multiplier).toFixed(2)}x`;
}

const NICE_FACTORS = [1, 2, 5] as const;

/** Picks a "nice" axis step (1, 2, 5 x 10^n) producing at most `maxTicks` intervals. */
export function niceStep(range: number, maxTicks: number): number {
  if (range <= 0 || maxTicks <= 0) return 1;
  const rough = range / maxTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  for (const factor of NICE_FACTORS) {
    const step = factor * magnitude;
    if (step >= rough) return step;
  }
  return 10 * magnitude;
}

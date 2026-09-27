export type TimeSource = () => number;

/** Monotonic local time in ms. Never use Date.now() for elapsed-time calculations. */
export const monotonicNow: TimeSource = () => performance.now();

export function formatCountdown(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

export function formatSeconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

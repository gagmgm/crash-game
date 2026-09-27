/** Colors and fonts shared by Pixi objects (CSS has its own tokens). */
export const theme = {
  background: 0x0b0f1a,
  backgroundGlow: 0x1b2a55,
  grid: 0x1f2940,
  axis: 0x3a4766,
  label: 0x8190ad,
  curve: 0x38bdf8,
  curveFill: 0x0ea5e9,
  crashed: 0xef4444,
  success: 0x22c55e,
  warning: 0xf59e0b,
  text: 0xffffff,
  mutedText: 0x9aa6c2,
  star: 0xc7d2fe,
  fontFamily: 'Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  monoFontFamily: '"Segoe UI", Roboto, Helvetica, Arial, sans-serif',
} as const;

/** Multiplier color ramp: cool at low values, warmer as it climbs. */
export function multiplierTint(multiplier: number): number {
  if (multiplier < 2) return 0xffffff;
  if (multiplier < 5) return 0x7dd3fc;
  if (multiplier < 10) return 0xa78bfa;
  if (multiplier < 50) return 0xf0abfc;
  return 0xfbbf24;
}

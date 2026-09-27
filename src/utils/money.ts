/**
 * Money is represented as integer minor units (cents) to avoid float drift.
 * The client never computes authoritative money; these helpers exist for
 * input parsing, display and the mock server.
 */
export type MinorUnits = number;

export const MINOR_PER_MAJOR = 100;

export function isValidMinor(value: unknown): value is MinorUnits {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function toMinor(major: number): MinorUnits {
  return Math.round(major * MINOR_PER_MAJOR);
}

/** Parses user input such as "10", "10.5", "10,25" into minor units. Returns null if invalid. */
export function parseMoneyInput(input: string): MinorUnits | null {
  const normalized = input.trim().replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  const [whole = '0', fraction = ''] = normalized.split('.');
  const minor = Number(whole) * MINOR_PER_MAJOR + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Formats minor units as a plain decimal string ("1025" -> "10.25"). */
export function minorToDecimalString(minor: MinorUnits): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / MINOR_PER_MAJOR);
  const fraction = String(abs % MINOR_PER_MAJOR).padStart(2, '0');
  return `${sign}${whole}.${fraction}`;
}

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(minor: MinorUnits, currency: string): string {
  let formatter = formatters.get(currency);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      formatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2 });
    }
    formatters.set(currency, formatter);
  }
  return formatter.format(minor / MINOR_PER_MAJOR);
}

/** Multipliers travel as numbers with 2 decimals; convert to integer hundredths for exact math. */
export function multiplierToHundredths(multiplier: number): number {
  return Math.round(multiplier * 100);
}

/** amount x multiplier, rounded down to a whole minor unit (house-favouring rounding). */
export function applyMultiplier(amount: MinorUnits, multiplier: number): MinorUnits {
  return Math.floor((amount * multiplierToHundredths(multiplier)) / 100);
}

export function clampMinor(value: MinorUnits, min: MinorUnits, max: MinorUnits): MinorUnits {
  return Math.min(max, Math.max(min, Math.round(value)));
}

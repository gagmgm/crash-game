import { describe, expect, it } from 'vitest';
import {
  applyMultiplier,
  formatMoney,
  minorToDecimalString,
  multiplierToHundredths,
  parseMoneyInput,
  toMinor,
} from '../utils/money';

describe('money utilities', () => {
  it('converts major to minor units without float drift', () => {
    expect(toMinor(10.25)).toBe(1025);
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(toMinor(1000)).toBe(100_000);
  });

  it('parses user input strictly', () => {
    expect(parseMoneyInput('10')).toBe(1000);
    expect(parseMoneyInput('10.5')).toBe(1050);
    expect(parseMoneyInput('10,25')).toBe(1025);
    expect(parseMoneyInput(' 0.01 ')).toBe(1);
    expect(parseMoneyInput('10.255')).toBeNull();
    expect(parseMoneyInput('-5')).toBeNull();
    expect(parseMoneyInput('abc')).toBeNull();
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('1e3')).toBeNull();
  });

  it('formats minor units', () => {
    expect(minorToDecimalString(1025)).toBe('10.25');
    expect(minorToDecimalString(5)).toBe('0.05');
    expect(minorToDecimalString(-150)).toBe('-1.50');
    expect(formatMoney(123456, 'USD')).toContain('1,234.56');
  });

  it('applies multipliers with integer math, rounding down', () => {
    expect(multiplierToHundredths(2.35)).toBe(235);
    expect(applyMultiplier(1000, 2.35)).toBe(2350);
    expect(applyMultiplier(333, 1.5)).toBe(499); // 499.5 -> 499
    expect(applyMultiplier(1, 1.01)).toBe(1);
    expect(applyMultiplier(10_000, 100)).toBe(1_000_000);
  });
});

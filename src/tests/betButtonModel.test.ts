import { describe, expect, it } from 'vitest';
import { getBetButtonModel, type BetButtonInput } from '../components/BetPanel/betButtonModel';
import { initialBetState } from '../state/betMachine';
import { BetStatus } from '../types/bet';
import { RoundState } from '../types/game';

const base: BetButtonInput = {
  bet: initialBetState,
  ctx: { connected: true, syncing: false, roundState: RoundState.BETTING, roundId: 'round-1' },
  inputAmount: 1000,
  limits: { min: 10, max: 100_000 },
  balance: 100_000,
  displayMultiplier: 2.35,
  currency: 'USD',
};

describe('bet button model', () => {
  it('offers BET during betting', () => {
    const model = getBetButtonModel(base);
    expect(model.action).toBe('bet');
    expect(model.disabled).toBe(false);
  });

  it('disables BET when disconnected, with a reason', () => {
    const model = getBetButtonModel({ ...base, ctx: { ...base.ctx, connected: false } });
    expect(model.disabled).toBe(true);
    expect(model.sublabel).toBe('Not connected');
  });

  it('shows a pending, non-clickable state while placing / cashing out', () => {
    for (const status of [BetStatus.PLACING, BetStatus.CASHING_OUT]) {
      const model = getBetButtonModel({ ...base, bet: { ...initialBetState, status } });
      expect(model.disabled).toBe(true);
      expect(model.action).toBeNull();
      expect(model.variant).toBe('pending');
    }
  });

  it('offers CASH OUT with an estimated value while running', () => {
    const model = getBetButtonModel({
      ...base,
      ctx: { ...base.ctx, roundState: RoundState.RUNNING },
      bet: {
        ...initialBetState,
        status: BetStatus.ACTIVE,
        roundId: 'round-1',
        betId: 'b',
        amount: 1000,
      },
    });
    expect(model.action).toBe('cashout');
    expect(model.sublabel).toContain('23.50');
  });

  it('shows the authoritative result after cash-out', () => {
    const model = getBetButtonModel({
      ...base,
      bet: {
        ...initialBetState,
        status: BetStatus.CASHED_OUT,
        amount: 1000,
        cashoutMultiplier: 1.8,
        payout: 1800,
      },
    });
    expect(model.label).toContain('1.80x');
    expect(model.sublabel).toContain('18.00');
    expect(model.disabled).toBe(true);
  });
});

import { canCashOut, canPlaceBet, type ActionContext, type BetState } from '../../state/betMachine';
import { BetStatus, type BetLimits } from '../../types/bet';
import { RoundState } from '../../types/game';
import { applyMultiplier, formatMoney, type MinorUnits } from '../../utils/money';

export type BetAction = 'bet' | 'cashout' | null;
export type ButtonVariant = 'bet' | 'cashout' | 'pending' | 'success' | 'danger' | 'idle';

export interface BetButtonModel {
  action: BetAction;
  disabled: boolean;
  variant: ButtonVariant;
  label: string;
  sublabel: string | null;
}

export interface BetButtonInput {
  bet: BetState;
  ctx: ActionContext;
  inputAmount: MinorUnits;
  limits: BetLimits;
  balance: MinorUnits | null;
  displayMultiplier: number;
  currency: string;
}

/** Maps bet + round state to what the primary button shows. Pure; no side effects. */
export function getBetButtonModel(input: BetButtonInput): BetButtonModel {
  const { bet, ctx, currency } = input;
  const money = (v: MinorUnits) => formatMoney(v, currency);

  switch (bet.status) {
    case BetStatus.PLACING:
      return pending('PLACING BET…', 'Waiting for server');
    case BetStatus.CASHING_OUT:
      return pending('CASHING OUT…', 'Waiting for server confirmation');
    case BetStatus.CASHED_OUT:
      return {
        action: null,
        disabled: true,
        variant: 'success',
        label: `CASHED OUT ${bet.cashoutMultiplier?.toFixed(2) ?? ''}x`,
        sublabel: bet.payout !== null ? `+${money(bet.payout)}` : null,
      };
    case BetStatus.LOST:
      return {
        action: null,
        disabled: true,
        variant: 'danger',
        label: 'BUSTED',
        sublabel: 'Wait for next round',
      };
    case BetStatus.ACTIVE: {
      if (ctx.roundState !== RoundState.RUNNING) {
        return {
          action: null,
          disabled: true,
          variant: 'idle',
          label: 'BET PLACED',
          sublabel: 'Waiting for launch',
        };
      }
      const guard = canCashOut(bet, ctx);
      const potential = applyMultiplier(bet.amount ?? 0, input.displayMultiplier);
      return {
        action: guard.ok ? 'cashout' : null,
        disabled: !guard.ok,
        variant: 'cashout',
        label: 'CASH OUT',
        sublabel: guard.ok ? money(potential) : (guard.reason ?? null),
      };
    }
    case BetStatus.NONE:
    case BetStatus.REJECTED: {
      const guard = canPlaceBet(bet, ctx, input.inputAmount, input.limits, input.balance);
      return {
        action: guard.ok ? 'bet' : null,
        disabled: !guard.ok,
        variant: 'bet',
        label: 'BET',
        sublabel: guard.ok ? money(input.inputAmount) : (guard.reason ?? null),
      };
    }
  }
}

function pending(label: string, sublabel: string): BetButtonModel {
  return { action: null, disabled: true, variant: 'pending', label, sublabel };
}

import { createStore } from 'zustand/vanilla';
import { gameConfig } from '../config/gameConfig';
import { initialBetState, type BetState } from '../state/betMachine';
import type { MinorUnits } from '../utils/money';

/**
 * Bet lifecycle (driven by GameController through the pure bet reducer) plus the
 * amount the user is editing. Only `setInputAmount` is called from React.
 */
export interface BetStoreState extends BetState {
  inputAmount: MinorUnits;
  setInputAmount(amount: MinorUnits): void;
}

export const createBetStore = () =>
  createStore<BetStoreState>()((set) => ({
    ...initialBetState,
    inputAmount: gameConfig.bet.defaultBet,
    setInputAmount: (amount) => set({ inputAmount: Math.max(0, Math.round(amount)) }),
  }));
export type BetStore = ReturnType<typeof createBetStore>;

export function selectBetState(state: BetStoreState): BetState {
  const { inputAmount: _input, setInputAmount: _set, ...bet } = state;
  return bet;
}

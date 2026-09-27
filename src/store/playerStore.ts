import { createStore } from 'zustand/vanilla';
import { gameConfig } from '../config/gameConfig';
import type { MinorUnits } from '../utils/money';

/** Mirror of the server-owned wallet. The client never computes the balance itself. */
export interface PlayerStoreState {
  balance: MinorUnits | null;
  currency: string;
  balanceVersion: number;
}

export const createPlayerStore = () =>
  createStore<PlayerStoreState>()(() => ({
    balance: null,
    currency: gameConfig.currency,
    balanceVersion: -1,
  }));
export type PlayerStore = ReturnType<typeof createPlayerStore>;

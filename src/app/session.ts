import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { BetStoreState } from '../store/betStore';
import type { GameStoreState } from '../store/gameStore';
import type { PlayerStoreState } from '../store/playerStore';
import type { GameSession } from './createGameSession';

export const GameSessionContext = createContext<GameSession | null>(null);

export function useGameSession(): GameSession {
  const session = useContext(GameSessionContext);
  if (!session) throw new Error('useGameSession must be used inside GameSessionContext');
  return session;
}

export function useGameStore<T>(selector: (state: GameStoreState) => T): T {
  return useStore(useGameSession().stores.game, selector);
}

export function useBetStore<T>(selector: (state: BetStoreState) => T): T {
  return useStore(useGameSession().stores.bet, selector);
}

export function usePlayerStore<T>(selector: (state: PlayerStoreState) => T): T {
  return useStore(useGameSession().stores.player, selector);
}

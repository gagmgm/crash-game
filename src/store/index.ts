import { createBetStore, type BetStore } from './betStore';
import { createGameStore, type GameStore } from './gameStore';
import { createPlayerStore, type PlayerStore } from './playerStore';

export interface AppStores {
  game: GameStore;
  bet: BetStore;
  player: PlayerStore;
}

/** Stores are created per game session (not module singletons) so tests and remounts are isolated. */
export function createAppStores(): AppStores {
  return { game: createGameStore(), bet: createBetStore(), player: createPlayerStore() };
}

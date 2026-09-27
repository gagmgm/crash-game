import { createStore } from 'zustand/vanilla';
import { gameConfig } from '../config/gameConfig';
import type { BetLimits } from '../types/bet';
import { RoundState, type RoundResult } from '../types/game';
import { ConnectionStatus } from '../types/network';

/**
 * Round/connection state for the React UI. Written only by GameController.
 * High-frequency values (displayMultiplier, countdown) are throttled by the controller;
 * PixiJS reads the per-frame state from RoundTimeline instead.
 */
export interface GameStoreState {
  connectionStatus: ConnectionStatus;
  /** True while waiting for an authoritative snapshot; commands are blocked. */
  syncing: boolean;
  roundId: string | null;
  roundState: RoundState;
  bettingEndsAt: number | null;
  roundStartedAt: number | null;
  serverMultiplier: number;
  displayMultiplier: number;
  crashMultiplier: number | null;
  bettingCountdownMs: number | null;
  recentRounds: RoundResult[];
  betLimits: BetLimits;
  rttMs: number | null;
  lastError: string | null;
}

export const initialGameState: GameStoreState = {
  connectionStatus: ConnectionStatus.DISCONNECTED,
  syncing: false,
  roundId: null,
  roundState: RoundState.IDLE,
  bettingEndsAt: null,
  roundStartedAt: null,
  serverMultiplier: 1,
  displayMultiplier: 1,
  crashMultiplier: null,
  bettingCountdownMs: null,
  recentRounds: [],
  betLimits: { min: gameConfig.bet.minBet, max: gameConfig.bet.maxBet },
  rttMs: null,
  lastError: null,
};

export const createGameStore = () => createStore<GameStoreState>()(() => ({ ...initialGameState }));
export type GameStore = ReturnType<typeof createGameStore>;

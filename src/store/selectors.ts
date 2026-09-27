import type { ActionContext } from '../state/betMachine';
import { ConnectionStatus } from '../types/network';
import type { GameStoreState } from './gameStore';

export function selectActionContext(game: GameStoreState): ActionContext {
  return {
    connected: game.connectionStatus === ConnectionStatus.CONNECTED,
    syncing: game.syncing,
    roundState: game.roundState,
    roundId: game.roundId,
  };
}

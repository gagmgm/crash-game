import { gameConfig, type GameConfig } from '../config/gameConfig';
import { EventBus } from '../game/core/EventBus';
import { GameClock } from '../game/core/GameClock';
import { RoundTimeline } from '../game/core/RoundTimeline';
import { GameController } from '../game/GameController';
import type { GameEvents } from '../game/gameEvents';
import { createMockDevControls, type MockDevControls } from '../mock/devControls';
import { MockCrashServer } from '../mock/MockCrashServer';
import { MockTransport } from '../mock/MockTransport';
import { BrowserWebSocketTransport } from '../network/BrowserWebSocketTransport';
import { ReconnectionManager } from '../network/ReconnectionManager';
import { WebSocketClient } from '../network/WebSocketClient';
import { AudioManager } from '../services/AudioManager';
import { createAppStores, type AppStores } from '../store';
import type { Transport } from '../types/network';

export interface GameSession {
  readonly backend: 'mock' | 'websocket';
  readonly stores: AppStores;
  readonly controller: GameController;
  readonly timeline: RoundTimeline;
  readonly clock: GameClock;
  readonly events: EventBus<GameEvents>;
  readonly audio: AudioManager;
  /** Mock/test controls; null when talking to a real backend. */
  readonly devControls: MockDevControls | null;
  start(): void;
  stop(): void;
}

/**
 * Composition root. This is the only place that knows which transport is used:
 * swapping MockTransport for a real WebSocket changes nothing above the transport.
 * Construction has no side effects; start()/stop() are idempotent and restartable
 * (React StrictMode mounts, unmounts and remounts effects in development).
 */
export function createGameSession(config: GameConfig = gameConfig): GameSession {
  const stores = createAppStores();
  const clock = new GameClock();
  const timeline = new RoundTimeline(config.timeline);
  const events = new EventBus<GameEvents>();
  const audio = new AudioManager();

  let transport: Transport;
  let server: MockCrashServer | null = null;
  let mockTransport: MockTransport | null = null;
  if (config.network.websocketUrl) {
    transport = new BrowserWebSocketTransport(config.network.websocketUrl);
  } else {
    server = new MockCrashServer();
    mockTransport = new MockTransport(server);
    transport = mockTransport;
  }

  const connection = new WebSocketClient(
    transport,
    new ReconnectionManager(config.network.reconnect),
  );
  const controller = new GameController({
    connection,
    stores,
    clock,
    timeline,
    events,
    audio,
    config,
  });

  let started = false;
  return {
    backend: server ? 'mock' : 'websocket',
    stores,
    controller,
    timeline,
    clock,
    events,
    audio,
    devControls: server && mockTransport ? createMockDevControls(server, mockTransport) : null,
    start() {
      if (started) return;
      started = true;
      mockTransport?.goOnline();
      server?.start();
      audio.attach();
      controller.start();
    },
    stop() {
      if (!started) return;
      started = false;
      controller.stop();
      connection.disconnect();
      mockTransport?.dispose();
      server?.stop();
      audio.detach();
    },
  };
}

import type { ClientMessage, GameSnapshot, ServerMessage } from '../network/protocol';
import type { GameConnection, MessageListener, StatusListener } from '../network/WebSocketClient';
import { ConnectionStatus } from '../types/network';

/** In-test connection: records sent commands, lets the test push server messages. */
export class FakeConnection implements GameConnection {
  status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  readonly sent: ClientMessage[] = [];
  private readonly listeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();

  connect(): void {
    this.setStatus(ConnectionStatus.CONNECTED);
  }
  disconnect(): void {
    this.setStatus(ConnectionStatus.DISCONNECTED);
  }
  reconnect(): void {
    this.setStatus(ConnectionStatus.RECONNECTING);
    this.setStatus(ConnectionStatus.CONNECTED);
  }
  send(message: ClientMessage): boolean {
    if (this.status !== ConnectionStatus.CONNECTED) return false;
    this.sent.push(message);
    return true;
  }
  subscribe(listener: MessageListener) {
    this.listeners.add(listener);
    return () => this.unsubscribe(listener);
  }
  unsubscribe(listener: MessageListener): void {
    this.listeners.delete(listener);
  }
  onStatusChange(listener: StatusListener) {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }
  emit(message: ServerMessage): void {
    this.listeners.forEach((l) => l(message));
  }
  lastSent<T extends ClientMessage['type']>(
    type: T,
  ): Extract<ClientMessage, { type: T }> | undefined {
    return [...this.sent].reverse().find((m) => m.type === type) as
      Extract<ClientMessage, { type: T }> | undefined;
  }
  countSent(type: ClientMessage['type']): number {
    return this.sent.filter((m) => m.type === type).length;
  }
}

export function makeSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    roundId: 'round-100',
    state: 'BETTING',
    serverTime: 1_000,
    bettingEndsAt: 6_000,
    startsAt: null,
    roundStartedAt: null,
    growthRate: 0.00006,
    currentMultiplier: 1,
    crashMultiplier: null,
    crashedAt: null,
    playerBet: null,
    lastSettledBet: null,
    balance: 100_000,
    balanceVersion: 0,
    currency: 'USD',
    recentRounds: [],
    betLimits: { min: 10, max: 100_000 },
    ...overrides,
  };
}

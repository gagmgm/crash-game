import {
  ConnectionStatus,
  type Transport,
  type TransportCloseInfo,
  type TransportConnection,
  type Unsubscribe,
} from '../types/network';
import { createLogger, type Logger } from '../utils/logger';
import { parseServerMessage, serializeMessage } from './messages';
import type { ClientMessage, ServerMessage } from './protocol';
import type { ReconnectionManager } from './ReconnectionManager';

export type MessageListener = (message: ServerMessage) => void;
export type StatusListener = (status: ConnectionStatus) => void;

/** The interface GameController depends on. Anything that speaks the protocol can implement it. */
export interface GameConnection {
  readonly status: ConnectionStatus;
  connect(): void;
  disconnect(): void;
  reconnect(): void;
  send(message: ClientMessage): boolean;
  subscribe(listener: MessageListener): Unsubscribe;
  unsubscribe(listener: MessageListener): void;
  onStatusChange(listener: StatusListener): Unsubscribe;
}

/**
 * Protocol-level client over any Transport (real WebSocket or the in-memory mock).
 * Handles (de)serialization, validation, connection status and automatic reconnection.
 */
export class WebSocketClient implements GameConnection {
  private currentStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private connection: TransportConnection | null = null;
  /** Incremented per connection so callbacks from superseded connections are ignored. */
  private generation = 0;
  private intentionalClose = false;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();

  constructor(
    private readonly transport: Transport,
    private readonly reconnection: ReconnectionManager,
    private readonly logger: Logger = createLogger('ws'),
  ) {}

  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  connect(): void {
    if (this.connection) return;
    this.intentionalClose = false;
    this.reconnection.cancel();
    this.setStatus(ConnectionStatus.CONNECTING);
    this.open();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.reconnection.reset();
    this.closeConnection();
    this.setStatus(ConnectionStatus.DISCONNECTED);
  }

  /** Drops the current connection (if any) and reconnects immediately. */
  reconnect(): void {
    this.intentionalClose = false;
    this.reconnection.reset();
    this.closeConnection();
    this.setStatus(ConnectionStatus.RECONNECTING);
    this.open();
  }

  send(message: ClientMessage): boolean {
    if (this.currentStatus !== ConnectionStatus.CONNECTED || !this.connection) {
      this.logger.warn(`send(${message.type}) refused: not connected`);
      return false;
    }
    try {
      this.connection.send(serializeMessage(message));
      return true;
    } catch (error) {
      this.logger.error('send failed', error);
      return false;
    }
  }

  subscribe(listener: MessageListener): Unsubscribe {
    this.messageListeners.add(listener);
    return () => this.unsubscribe(listener);
  }

  unsubscribe(listener: MessageListener): void {
    this.messageListeners.delete(listener);
  }

  onStatusChange(listener: StatusListener): Unsubscribe {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  dispose(): void {
    this.intentionalClose = true;
    this.reconnection.dispose();
    this.closeConnection();
    this.messageListeners.clear();
    this.statusListeners.clear();
    this.currentStatus = ConnectionStatus.DISCONNECTED;
  }

  private open(): void {
    const generation = ++this.generation;
    const isCurrent = () => generation === this.generation;
    try {
      this.connection = this.transport.open({
        onOpen: () => {
          if (!isCurrent()) return;
          this.reconnection.reset();
          this.setStatus(ConnectionStatus.CONNECTED);
        },
        onMessage: (data) => {
          if (isCurrent()) this.handleFrame(data);
        },
        onClose: (info) => {
          if (isCurrent()) this.handleClose(info);
        },
        onError: (error) => {
          if (isCurrent()) this.logger.warn('transport error', error);
        },
      });
    } catch (error) {
      this.logger.error('transport open failed', error);
      this.handleClose({ wasClean: false, reason: 'open failed' });
    }
  }

  private handleFrame(data: string): void {
    const result = parseServerMessage(data);
    if (!result.ok) {
      this.logger.warn(`dropping invalid server message: ${result.error}`);
      return;
    }
    for (const listener of this.messageListeners) {
      try {
        listener(result.value);
      } catch (error) {
        // One faulty handler must not break message delivery for the rest.
        this.logger.error(`listener failed on ${result.value.type}`, error);
      }
    }
  }

  private handleClose(info: TransportCloseInfo): void {
    this.connection = null;
    this.generation += 1;
    if (this.intentionalClose) {
      this.setStatus(ConnectionStatus.DISCONNECTED);
      return;
    }
    this.logger.info(`connection lost (${info.reason ?? 'no reason'}), reconnecting`);
    const scheduled = this.reconnection.schedule(() => this.open());
    this.setStatus(scheduled ? ConnectionStatus.RECONNECTING : ConnectionStatus.ERROR);
  }

  private closeConnection(): void {
    this.generation += 1;
    const connection = this.connection;
    this.connection = null;
    connection?.close();
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

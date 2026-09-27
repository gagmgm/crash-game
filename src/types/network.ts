export const ConnectionStatus = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  ERROR: 'ERROR',
} as const;
export type ConnectionStatus = (typeof ConnectionStatus)[keyof typeof ConnectionStatus];

export type Unsubscribe = () => void;

export interface TransportCloseInfo {
  code?: number;
  reason?: string;
  /** false when the connection dropped or could not be established. */
  wasClean: boolean;
}

export interface TransportHandlers {
  onOpen(): void;
  onMessage(data: string): void;
  onClose(info: TransportCloseInfo): void;
  onError(error: unknown): void;
}

export interface TransportConnection {
  send(data: string): void;
  /** Closes the connection. No handler is invoked after this call. */
  close(): void;
}

/**
 * Lowest network layer: moves serialized frames. Both the in-memory mock and a real
 * WebSocket implement this, so everything above it is transport-agnostic.
 */
export interface Transport {
  open(handlers: TransportHandlers): TransportConnection;
}

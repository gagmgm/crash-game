import { gameConfig } from '../config/gameConfig';
import { serializeMessage } from '../network/messages';
import type { ServerMessage } from '../network/protocol';
import type { Transport, TransportConnection, TransportHandlers } from '../types/network';
import { TimerGroup } from '../utils/timers';
import type { MockCrashServer, MockServerSession } from './MockCrashServer';

export interface NetworkConditions {
  latencyMs: number;
  /** Probability [0..1] that an individual message is lost (each direction). */
  dropRate: number;
  offline: boolean;
}

export interface MockTransportOptions {
  latencyMs?: number;
  dropRate?: number;
  connectDelayMs?: number;
  random?: () => number;
}

/**
 * Transport that connects to an in-memory MockCrashServer. Frames are serialized to JSON
 * and delivered asynchronously with simulated latency / loss, so the client exercises
 * the same code path it will use with a real WebSocket.
 */
export class MockTransport implements Transport {
  readonly conditions: NetworkConditions;
  private readonly connections = new Set<MockConnection>();
  private readonly connectDelayMs: number;
  private readonly random: () => number;

  constructor(
    private readonly server: MockCrashServer,
    options: MockTransportOptions = {},
  ) {
    this.conditions = {
      latencyMs: options.latencyMs ?? 0,
      dropRate: options.dropRate ?? 0,
      offline: false,
    };
    this.connectDelayMs = options.connectDelayMs ?? gameConfig.mockNetwork.connectDelayMs;
    this.random = options.random ?? Math.random;
  }

  open(handlers: TransportHandlers): TransportConnection {
    const connection = new MockConnection(this.server, handlers, this, () =>
      this.connections.delete(connection),
    );
    this.connections.add(connection);
    connection.start(this.connectDelayMs);
    return connection;
  }

  setLatency(ms: number): void {
    this.conditions.latencyMs = Math.max(0, ms);
  }

  setDropRate(rate: number): void {
    this.conditions.dropRate = Math.min(1, Math.max(0, rate));
  }

  /** Simulates the network going down: live connections drop, new ones fail. */
  goOffline(): void {
    this.conditions.offline = true;
    [...this.connections].forEach((c) => c.fail('network unreachable'));
  }

  goOnline(): void {
    this.conditions.offline = false;
  }

  shouldDrop(): boolean {
    return this.conditions.dropRate > 0 && this.random() < this.conditions.dropRate;
  }

  dispose(): void {
    [...this.connections].forEach((c) => c.close());
    this.connections.clear();
  }
}

class MockConnection implements TransportConnection {
  private readonly timers = new TimerGroup();
  private session: MockServerSession | null = null;
  private closed = false;
  // FIFO per direction: a message is never delivered before one sent earlier.
  private lastToClientAt = 0;
  private lastToServerAt = 0;

  constructor(
    private readonly server: MockCrashServer,
    private readonly handlers: TransportHandlers,
    private readonly transport: MockTransport,
    private readonly onDisposed: () => void,
  ) {}

  start(connectDelayMs: number): void {
    const delay = connectDelayMs + this.transport.conditions.latencyMs;
    this.timers.timeout(() => {
      if (this.closed) return;
      if (this.transport.conditions.offline) {
        this.fail('network unreachable');
        return;
      }
      this.session = this.server.connect((message) => this.toClient(message));
      this.handlers.onOpen();
    }, delay);
  }

  send(data: string): void {
    if (this.closed || this.transport.shouldDrop()) return;
    const at = this.nextDelivery('server');
    this.timers.timeout(() => {
      if (!this.closed) this.session?.receive(data);
    }, at - performance.now());
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.timers.clearAll();
    this.session?.close();
    this.session = null;
    this.onDisposed();
  }

  /** Abnormal termination: notifies the client (like a dropped socket). */
  fail(reason: string): void {
    if (this.closed) return;
    this.close();
    this.handlers.onClose({ wasClean: false, reason });
  }

  private toClient(message: ServerMessage): void {
    if (this.closed || this.transport.shouldDrop()) return;
    const frame = serializeMessage(message);
    const at = this.nextDelivery('client');
    this.timers.timeout(() => {
      if (!this.closed) this.handlers.onMessage(frame);
    }, at - performance.now());
  }

  private nextDelivery(direction: 'client' | 'server'): number {
    const target = performance.now() + this.transport.conditions.latencyMs;
    if (direction === 'client') {
      this.lastToClientAt = Math.max(target, this.lastToClientAt);
      return this.lastToClientAt;
    }
    this.lastToServerAt = Math.max(target, this.lastToServerAt);
    return this.lastToServerAt;
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockCrashServer } from '../mock/MockCrashServer';
import { MockTransport } from '../mock/MockTransport';
import type { ServerMessage } from '../network/protocol';
import { ReconnectionManager } from '../network/ReconnectionManager';
import { WebSocketClient } from '../network/WebSocketClient';
import { ConnectionStatus } from '../types/network';
import { silentLogger } from '../utils/logger';
import { useFakeClock } from './helpers';

const backoff = { baseDelayMs: 100, maxDelayMs: 1000, maxAttempts: 3, jitterRatio: 0 };

describe('ReconnectionManager', () => {
  beforeEach(useFakeClock);
  afterEach(() => vi.useRealTimers());

  it('backs off exponentially up to a cap', () => {
    const rm = new ReconnectionManager({ ...backoff, maxAttempts: 10 }, () => 0.5);
    expect([0, 1, 2, 3, 4, 5].map((a) => rm.delayForAttempt(a))).toEqual([
      100, 200, 400, 800, 1000, 1000,
    ]);
  });

  it('stops after the attempt budget and resets on success', () => {
    const rm = new ReconnectionManager(backoff);
    const attempt = vi.fn();
    expect(rm.schedule(attempt)).toBe(true);
    vi.advanceTimersByTime(100);
    expect(attempt).toHaveBeenCalledTimes(1);
    rm.schedule(attempt);
    rm.schedule(attempt);
    expect(rm.schedule(attempt)).toBe(false);
    rm.reset();
    expect(rm.attempts).toBe(0);
    expect(rm.schedule(attempt)).toBe(true);
    rm.dispose();
  });
});

describe('WebSocketClient over MockTransport', () => {
  beforeEach(useFakeClock);
  afterEach(() => vi.useRealTimers());

  function setup(maxAttempts = 5) {
    const server = new MockCrashServer({ random: () => 0.5 });
    server.start();
    const transport = new MockTransport(server, { latencyMs: 50, connectDelayMs: 10 });
    const client = new WebSocketClient(
      transport,
      new ReconnectionManager({ ...backoff, maxAttempts }),
      silentLogger,
    );
    const statuses: ConnectionStatus[] = [];
    const messages: ServerMessage[] = [];
    client.onStatusChange((s) => statuses.push(s));
    client.subscribe((m) => messages.push(m));
    return { server, transport, client, statuses, messages };
  }

  it('connects, receives validated messages with latency', () => {
    const { client, messages } = setup();
    client.connect();
    expect(client.status).toBe(ConnectionStatus.CONNECTING);
    vi.advanceTimersByTime(60);
    expect(client.status).toBe(ConnectionStatus.CONNECTED);
    expect(messages).toHaveLength(0); // CONNECTED is still in flight
    vi.advanceTimersByTime(50);
    expect(messages[0]?.type).toBe('CONNECTED');
    client.dispose();
  });

  it('enters RECONNECTING on connection loss and recovers when the network returns', () => {
    const { client, transport, statuses } = setup();
    client.connect();
    vi.advanceTimersByTime(100);
    transport.goOffline();
    expect(client.status).toBe(ConnectionStatus.RECONNECTING);
    vi.advanceTimersByTime(300); // an attempt fails while offline
    expect(client.status).toBe(ConnectionStatus.RECONNECTING);
    transport.goOnline();
    vi.advanceTimersByTime(2000);
    expect(client.status).toBe(ConnectionStatus.CONNECTED);
    expect(statuses).toContain(ConnectionStatus.RECONNECTING);
    client.dispose();
  });

  it('goes to ERROR when the reconnect budget is exhausted', () => {
    const { client, transport } = setup(2);
    client.connect();
    vi.advanceTimersByTime(100);
    transport.goOffline();
    vi.advanceTimersByTime(10_000);
    expect(client.status).toBe(ConnectionStatus.ERROR);
    client.dispose();
  });

  it('refuses to send while not connected and stays down after explicit disconnect', () => {
    const { client } = setup();
    expect(client.send({ type: 'REQUEST_SNAPSHOT', requestId: 'x' })).toBe(false);
    client.connect();
    vi.advanceTimersByTime(100);
    client.disconnect();
    vi.advanceTimersByTime(5000);
    expect(client.status).toBe(ConnectionStatus.DISCONNECTED);
    client.dispose();
  });

  it('drops malformed frames without breaking the stream', () => {
    const listener = vi.fn();
    const handlersRef: { current: Parameters<MockTransport['open']>[0] | null } = { current: null };
    const client = new WebSocketClient(
      {
        open: (handlers) => {
          handlersRef.current = handlers;
          setTimeout(() => handlers.onOpen(), 0);
          return { send: () => {}, close: () => {} };
        },
      },
      new ReconnectionManager(backoff),
      silentLogger,
    );
    client.subscribe(listener);
    client.connect();
    vi.advanceTimersByTime(1);
    handlersRef.current?.onMessage('garbage');
    handlersRef.current?.onMessage(JSON.stringify({ type: 'UNKNOWN', serverTimestamp: 1 }));
    handlersRef.current?.onMessage(
      JSON.stringify({
        type: 'BALANCE_UPDATED',
        serverTimestamp: 1,
        balance: 5,
        currency: 'USD',
        version: 1,
      }),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    client.dispose();
  });
});

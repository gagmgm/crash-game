import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameSession } from '../app/createGameSession';
import { EventBus } from '../game/core/EventBus';
import { ConnectionStatus } from '../types/network';
import { useFakeClock } from './helpers';

describe('session lifecycle / cleanup', () => {
  beforeEach(useFakeClock);
  afterEach(() => vi.useRealTimers());

  it('survives repeated start/stop cycles without leaking timers', () => {
    const session = createGameSession();
    const baseline = vi.getTimerCount();
    for (let i = 0; i < 5; i += 1) {
      session.start();
      session.start(); // idempotent
      vi.advanceTimersByTime(2_000);
      expect(session.stores.game.getState().connectionStatus).toBe(ConnectionStatus.CONNECTED);
      session.stop();
      session.stop();
      expect(vi.getTimerCount()).toBe(baseline);
    }
  });

  it('plays a full mock round end-to-end through the real transport stack', () => {
    const session = createGameSession();
    const dev = session.devControls;
    if (!dev) throw new Error('expected mock backend');
    session.start();
    vi.advanceTimersByTime(1_000);
    // A fresh round with a known crash point.
    dev.forceNextCrash(3);
    dev.startNextRound(); // BETTING -> STARTING (round 1 is skipped)
    vi.advanceTimersByTime(40_000); // round 1 plays out whatever it drew
    // Wait for the forced round's betting phase.
    for (let i = 0; i < 100 && session.stores.game.getState().roundState !== 'BETTING'; i += 1) {
      vi.advanceTimersByTime(500);
    }
    expect(session.controller.placeBet().ok).toBe(true);
    vi.advanceTimersByTime(500);
    expect(session.stores.bet.getState().status).toBe('ACTIVE');
    const balanceAfterBet = session.stores.player.getState().balance ?? 0;

    for (let i = 0; i < 100 && session.stores.game.getState().roundState !== 'RUNNING'; i += 1) {
      vi.advanceTimersByTime(200);
    }
    vi.advanceTimersByTime(12_000); // ~2x
    expect(session.controller.cashOut().ok).toBe(true);
    vi.advanceTimersByTime(500);
    const bet = session.stores.bet.getState();
    expect(bet.status).toBe('CASHED_OUT');
    expect(bet.cashoutMultiplier).toBeGreaterThan(1.9);
    expect(session.stores.player.getState().balance).toBe(balanceAfterBet + (bet.payout ?? 0));

    vi.advanceTimersByTime(30_000);
    expect(session.stores.game.getState().recentRounds.some((r) => r.crashMultiplier === 3)).toBe(
      true,
    );
    session.stop();
  });
});

describe('EventBus', () => {
  it('delivers typed events and unsubscribes cleanly', () => {
    const bus = new EventBus<{ ping: number }>();
    const received: number[] = [];
    const off = bus.on('ping', (n) => received.push(n));
    bus.emit('ping', 1);
    off();
    bus.emit('ping', 2);
    expect(received).toEqual([1]);
    expect(bus.listenerCount('ping')).toBe(0);
  });
});

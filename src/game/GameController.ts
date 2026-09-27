import { gameConfig, type GameConfig } from '../config/gameConfig';
import type {
  BalanceUpdatedMessage,
  CashoutRejectedMessage,
  GameSnapshot,
  PongMessage,
  RoundLifecycleMessage,
  RoundTickMessage,
  ServerMessage,
  SnapshotMessage,
} from '../network/protocol';
import type { GameConnection } from '../network/WebSocketClient';
import { silentAudio, type GameAudio } from '../services/AudioManager';
import {
  canCashOut,
  canPlaceBet,
  reduceBet,
  type BetEvent,
  type GuardResult,
} from '../state/betMachine';
import { classifyRoundTransition } from '../state/roundMachine';
import type { AppStores } from '../store';
import { selectBetState } from '../store/betStore';
import { addRoundResult, normalizeHistory } from '../store/history';
import { selectActionContext } from '../store/selectors';
import { BetStatus } from '../types/bet';
import { RoundState } from '../types/game';
import { ConnectionStatus, type Unsubscribe } from '../types/network';
import { createRequestId } from '../utils/id';
import { createLogger, type Logger } from '../utils/logger';
import { floorMultiplier } from '../utils/math';
import { TimerGroup, type TimerHandle } from '../utils/timers';
import { onPageVisibility } from '../utils/visibility';
import type { EventBus } from './core/EventBus';
import type { GameClock } from './core/GameClock';
import { createTimelineSample, type RoundTimeline } from './core/RoundTimeline';
import type { GameEvents } from './gameEvents';

export interface GameControllerDeps {
  connection: GameConnection;
  stores: AppStores;
  clock: GameClock;
  timeline: RoundTimeline;
  events: EventBus<GameEvents>;
  audio?: GameAudio;
  config?: GameConfig;
  logger?: Logger;
  createId?: (prefix: string) => string;
  /** Page visibility hook; injectable for tests. */
  watchVisibility?: typeof onPageVisibility;
}

const LIFECYCLE_TARGET: Record<RoundLifecycleMessage['type'], RoundState> = {
  BETTING_STARTED: RoundState.BETTING,
  ROUND_STARTING: RoundState.STARTING,
  ROUND_STARTED: RoundState.RUNNING,
  ROUND_CRASHED: RoundState.CRASHED,
  ROUND_FINISHED: RoundState.IDLE,
};

const MAX_RETIRED_ROUNDS = 64;
const MAX_PENDING_PINGS = 16;

/**
 * Orchestrates the client: turns server messages into store/timeline updates, sends
 * commands with request ids and guards, and resynchronizes from snapshots.
 *
 * Invariants:
 * - Nothing here decides an outcome. Bets, cash-outs, crashes and balances only change
 *   in response to server messages.
 * - Messages for retired/older rounds and responses to unknown request ids are ignored.
 * - While a snapshot is pending, other state messages are ignored: the snapshot (which
 *   the server produced after them) supersedes them.
 */
export class GameController {
  private readonly connection: GameConnection;
  private readonly stores: AppStores;
  private readonly clock: GameClock;
  private readonly timeline: RoundTimeline;
  private readonly events: EventBus<GameEvents>;
  private readonly audio: GameAudio;
  private readonly config: GameConfig;
  private readonly log: Logger;
  private readonly createId: (prefix: string) => string;
  private readonly watchVisibility: typeof onPageVisibility;

  private readonly timers = new TimerGroup();
  private subscriptions: Unsubscribe[] = [];
  private running = false;

  private readonly retiredRounds: string[] = [];
  private latestLifecycleTimestamp = -Infinity;
  private pendingSnapshotId: string | null = null;
  private snapshotTimer: TimerHandle | null = null;
  private betTimer: TimerHandle | null = null;
  private cashoutTimer: TimerHandle | null = null;
  private pingTimer: TimerHandle | null = null;
  private readonly pendingPings = new Map<string, number>();
  private delayEstimateMs: number | null = null;
  private readonly uiSample = createTimelineSample();

  constructor(deps: GameControllerDeps) {
    this.connection = deps.connection;
    this.stores = deps.stores;
    this.clock = deps.clock;
    this.timeline = deps.timeline;
    this.events = deps.events;
    this.audio = deps.audio ?? silentAudio;
    this.config = deps.config ?? gameConfig;
    this.log = deps.logger ?? createLogger('controller');
    this.createId = deps.createId ?? createRequestId;
    this.watchVisibility = deps.watchVisibility ?? onPageVisibility;
  }

  // ---------------------------------------------------------------- lifecycle

  start(): void {
    if (this.running) return;
    this.running = true;
    this.subscriptions = [
      this.connection.subscribe((message) => this.handleMessage(message)),
      this.connection.onStatusChange((status) => this.handleStatus(status)),
      this.watchVisibility((visible, hiddenForMs) => this.handleVisibility(visible, hiddenForMs)),
    ];
    this.timers.interval(() => this.publishUiState(), this.config.ui.storeUpdateIntervalMs);
    this.handleStatus(this.connection.status);
    this.connection.connect();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
    this.timers.clearAll();
    this.snapshotTimer = null;
    this.betTimer = null;
    this.cashoutTimer = null;
    this.pingTimer = null;
    this.pendingPings.clear();
    this.pendingSnapshotId = null;
    this.audio.stopFlightLoop();
  }

  // ---------------------------------------------------------------- commands

  placeBet(): GuardResult {
    const game = this.stores.game.getState();
    const betStore = this.stores.bet.getState();
    const bet = selectBetState(betStore);
    const amount = betStore.inputAmount;
    const guard = canPlaceBet(
      bet,
      selectActionContext(game),
      amount,
      game.betLimits,
      this.stores.player.getState().balance,
    );
    if (!guard.ok || !game.roundId) return guard;

    const requestId = this.createId('bet');
    const roundId = game.roundId;
    this.applyBet({ type: 'PLACE_REQUESTED', requestId, roundId, amount });
    const sent = this.connection.send({ type: 'PLACE_BET', requestId, roundId, amount });
    if (!sent) {
      // Never left the client, so rolling back is safe.
      this.stores.bet.setState({ ...bet, message: 'Not connected — bet not sent' });
      return { ok: false, reason: 'Not connected' };
    }
    this.timers.clear(this.betTimer);
    this.betTimer = this.timers.timeout(() => {
      const current = this.stores.bet.getState();
      if (current.status === BetStatus.PLACING && current.requestId === requestId) {
        this.log.warn('bet response timed out; resyncing');
        this.requestSnapshot('bet response timeout');
      }
    }, this.config.network.requestTimeoutMs);
    return { ok: true };
  }

  cashOut(): GuardResult {
    const game = this.stores.game.getState();
    const bet = selectBetState(this.stores.bet.getState());
    const guard = canCashOut(bet, selectActionContext(game));
    if (!guard.ok || !bet.roundId || !bet.betId) return guard;

    const requestId = this.createId('cashout');
    this.applyBet({ type: 'CASHOUT_REQUESTED', requestId });
    const sent = this.connection.send({
      type: 'CASH_OUT',
      requestId,
      roundId: bet.roundId,
      betId: bet.betId,
    });
    if (!sent) {
      this.stores.bet.setState({ ...bet, message: 'Not connected — cash-out not sent' });
      return { ok: false, reason: 'Not connected' };
    }
    this.timers.clear(this.cashoutTimer);
    this.cashoutTimer = this.timers.timeout(() => {
      const current = this.stores.bet.getState();
      if (current.status === BetStatus.CASHING_OUT && current.cashoutRequestId === requestId) {
        this.log.warn('cash-out response timed out; resyncing');
        this.requestSnapshot('cash-out response timeout');
      }
    }, this.config.network.requestTimeoutMs);
    return { ok: true };
  }

  requestSnapshot(reason: string): void {
    if (this.connection.status !== ConnectionStatus.CONNECTED) return;
    const requestId = this.createId('snap');
    this.log.info(`requesting snapshot (${reason})`);
    this.pendingSnapshotId = requestId;
    this.stores.game.setState({ syncing: true });
    if (!this.connection.send({ type: 'REQUEST_SNAPSHOT', requestId })) return;
    this.timers.clear(this.snapshotTimer);
    this.snapshotTimer = this.timers.timeout(() => {
      if (this.pendingSnapshotId === requestId) this.requestSnapshot('snapshot timeout');
    }, this.config.network.snapshotTimeoutMs);
  }

  reconnect(): void {
    this.connection.reconnect();
  }

  // ---------------------------------------------------------------- inbound

  private handleStatus(status: ConnectionStatus): void {
    this.stores.game.setState({ connectionStatus: status });
    if (status === ConnectionStatus.CONNECTED) {
      this.startPinging();
      this.requestSnapshot('connected');
      return;
    }
    this.timers.clear(this.pingTimer);
    this.timers.clear(this.snapshotTimer);
    this.pingTimer = null;
    this.pendingPings.clear();
    this.pendingSnapshotId = null;
    this.stores.game.setState({ syncing: false });
  }

  private handleVisibility(visible: boolean, hiddenForMs: number): void {
    if (!visible) return;
    this.events.emit('resynced', { reason: 'page visible' });
    if (hiddenForMs > this.config.network.visibilityResyncAfterMs) {
      this.requestSnapshot('page became visible');
    }
  }

  /** Entry point for every validated server message. */
  handleMessage(message: ServerMessage): void {
    this.clock.observeServerTimestamp(message.serverTimestamp);
    switch (message.type) {
      case 'CONNECTED':
        this.log.info(`connected: ${message.sessionId} (protocol v${message.protocolVersion})`);
        return;
      case 'PONG':
        this.handlePong(message);
        return;
      case 'SNAPSHOT':
        this.handleSnapshot(message);
        return;
      case 'ERROR':
        this.log.warn(`server error ${message.code}: ${message.message}`);
        this.stores.game.setState({ lastError: message.message });
        return;
    }

    if (this.pendingSnapshotId !== null) {
      this.log.debug(`ignoring ${message.type} while awaiting snapshot`);
      return;
    }

    switch (message.type) {
      case 'BETTING_STARTED':
      case 'ROUND_STARTING':
      case 'ROUND_STARTED':
      case 'ROUND_CRASHED':
      case 'ROUND_FINISHED':
        this.handleLifecycle(message);
        return;
      case 'ROUND_TICK':
        this.handleTick(message);
        return;
      case 'BET_ACCEPTED': {
        if (this.applyBet({ ...message, type: 'BET_ACCEPTED' })) {
          this.timers.clear(this.betTimer);
          this.audio.betAccepted();
        } else {
          this.log.debug(`ignored BET_ACCEPTED ${message.requestId} (stale/duplicate)`);
        }
        return;
      }
      case 'BET_REJECTED':
        if (
          this.applyBet({
            type: 'BET_REJECTED',
            requestId: message.requestId,
            reason: message.message,
          })
        ) {
          this.timers.clear(this.betTimer);
        }
        return;
      case 'CASHOUT_ACCEPTED':
        if (this.applyBet({ ...message, type: 'CASHOUT_ACCEPTED' })) {
          this.timers.clear(this.cashoutTimer);
          this.audio.cashout();
          this.events.emit('cashoutConfirmed', {
            roundId: message.roundId,
            multiplier: message.multiplier,
          });
        } else {
          this.log.debug(`ignored CASHOUT_ACCEPTED ${message.requestId} (stale/duplicate)`);
        }
        return;
      case 'CASHOUT_REJECTED':
        this.handleCashoutRejected(message);
        return;
      case 'BALANCE_UPDATED':
        this.handleBalance(message);
        return;
    }
  }

  private handleLifecycle(message: RoundLifecycleMessage): void {
    const game = this.stores.game.getState();
    if (this.isStaleRound(message.roundId, message.serverTimestamp)) {
      this.log.debug(`ignored stale ${message.type} for ${message.roundId}`);
      return;
    }
    const target = LIFECYCLE_TARGET[message.type];

    if (message.roundId !== game.roundId) {
      this.enterNewRound(message.roundId);
      if (message.type !== 'BETTING_STARTED') {
        this.log.warn(`joined ${message.roundId} mid-round (${message.type}); resyncing`);
        this.applyLifecycle(message);
        this.requestSnapshot('missed round start');
        return;
      }
      this.applyLifecycle(message);
      return;
    }

    const kind = classifyRoundTransition(game.roundState, target);
    if (kind === 'duplicate' || kind === 'stale') {
      this.log.debug(`ignored ${kind} ${message.type} for ${message.roundId}`);
      return;
    }
    if (kind === 'skip')
      this.log.info(`${game.roundState} -> ${target}: intermediate states missed`);
    this.applyLifecycle(message);
  }

  private applyLifecycle(message: RoundLifecycleMessage): void {
    const ts = message.serverTimestamp;
    this.latestLifecycleTimestamp = Math.max(this.latestLifecycleTimestamp, ts);
    const set = this.stores.game.setState;
    switch (message.type) {
      case 'BETTING_STARTED':
        this.timeline.setBetting(message.roundId, message.bettingEndsAt, ts);
        set({
          roundState: RoundState.BETTING,
          bettingEndsAt: message.bettingEndsAt,
          roundStartedAt: null,
          crashMultiplier: null,
          serverMultiplier: 1,
          displayMultiplier: 1,
        });
        break;
      case 'ROUND_STARTING':
        this.timeline.setStarting(message.roundId, message.startsAt, ts);
        set({ roundState: RoundState.STARTING, bettingCountdownMs: null });
        break;
      case 'ROUND_STARTED':
        this.timeline.setRunning(message.roundId, message.startedAt, message.growthRate, ts);
        set({
          roundState: RoundState.RUNNING,
          roundStartedAt: message.startedAt,
          bettingCountdownMs: null,
          serverMultiplier: 1,
          displayMultiplier: 1,
        });
        this.audio.roundStart();
        this.audio.startFlightLoop();
        break;
      case 'ROUND_CRASHED': {
        this.timeline.setCrashed(message.roundId, message.crashMultiplier, message.crashedAt);
        const game = this.stores.game.getState();
        set({
          roundState: RoundState.CRASHED,
          crashMultiplier: message.crashMultiplier,
          serverMultiplier: message.crashMultiplier,
          displayMultiplier: message.crashMultiplier,
          recentRounds: addRoundResult(
            game.recentRounds,
            { roundId: message.roundId, crashMultiplier: message.crashMultiplier },
            this.config.historyLength,
          ),
        });
        this.applyBet({ type: 'ROUND_CRASHED', roundId: message.roundId });
        this.audio.stopFlightLoop();
        this.audio.crash();
        break;
      }
      case 'ROUND_FINISHED':
        this.timeline.setIdle(message.roundId);
        set({
          roundState: RoundState.IDLE,
          recentRounds: normalizeHistory(message.recentRounds, this.config.historyLength),
        });
        break;
    }
  }

  private enterNewRound(roundId: string): void {
    const previous = this.stores.game.getState().roundId;
    if (previous) this.retire(previous);
    this.stores.game.setState({ roundId, roundState: RoundState.IDLE, bettingCountdownMs: null });
    const before = this.stores.bet.getState().unresolvedRoundId;
    this.applyBet({ type: 'NEW_ROUND', roundId });
    this.timers.clear(this.betTimer);
    this.timers.clear(this.cashoutTimer);
    const unresolved = this.stores.bet.getState().unresolvedRoundId;
    if (unresolved && unresolved !== before) {
      // Our bet's outcome never arrived (e.g. dropped messages); ask the server.
      this.timers.timeout(() => this.requestSnapshot('unresolved bet from previous round'), 0);
    }
  }

  private handleTick(message: RoundTickMessage): void {
    const game = this.stores.game.getState();
    if (message.roundId !== game.roundId || game.roundState !== RoundState.RUNNING) return;
    this.timeline.applyTick(message.elapsedMs, message.multiplier);
    this.observeDelay(this.clock.serverNow() - message.serverTimestamp);
    if (message.multiplier !== game.serverMultiplier) {
      this.stores.game.setState({ serverMultiplier: message.multiplier });
    }
  }

  private handleCashoutRejected(message: CashoutRejectedMessage): void {
    const game = this.stores.game.getState();
    const roundOver = message.reason === 'ROUND_CRASHED' || message.reason === 'ROUND_NOT_RUNNING';
    const roundRunning =
      !roundOver && game.roundId === message.roundId && game.roundState === RoundState.RUNNING;
    const applied = this.applyBet({
      type: 'CASHOUT_REJECTED',
      requestId: message.requestId,
      reason: message.message,
      roundRunning,
    });
    if (!applied) return;
    this.timers.clear(this.cashoutTimer);
    if (!roundOver) this.requestSnapshot(`cash-out rejected: ${message.reason}`);
  }

  private handleBalance(message: BalanceUpdatedMessage): void {
    const player = this.stores.player.getState();
    if (message.version <= player.balanceVersion) return; // out-of-order or duplicate
    this.stores.player.setState({
      balance: message.balance,
      currency: message.currency,
      balanceVersion: message.version,
    });
  }

  private handleSnapshot(message: SnapshotMessage): void {
    if (message.requestId !== null && message.requestId !== this.pendingSnapshotId) {
      this.log.debug('ignored snapshot for a superseded request');
      return;
    }
    if (message.requestId === null && message.serverTimestamp < this.latestLifecycleTimestamp) {
      this.log.debug('ignored stale unsolicited snapshot');
      return;
    }
    this.pendingSnapshotId = null;
    this.timers.clear(this.snapshotTimer);
    this.applySnapshot(message.snapshot);
  }

  private applySnapshot(snapshot: GameSnapshot): void {
    const game = this.stores.game.getState();
    if (game.roundId && game.roundId !== snapshot.roundId) this.retire(game.roundId);
    this.latestLifecycleTimestamp = Math.max(this.latestLifecycleTimestamp, snapshot.serverTime);

    this.timeline.restore(snapshot);
    this.stores.game.setState({
      roundId: snapshot.roundId,
      roundState: snapshot.state,
      bettingEndsAt: snapshot.bettingEndsAt,
      roundStartedAt: snapshot.roundStartedAt,
      serverMultiplier: snapshot.currentMultiplier,
      displayMultiplier: snapshot.crashMultiplier ?? snapshot.currentMultiplier,
      crashMultiplier: snapshot.crashMultiplier,
      recentRounds: normalizeHistory(snapshot.recentRounds, this.config.historyLength),
      betLimits: snapshot.betLimits,
      syncing: false,
      lastError: null,
    });
    this.stores.player.setState({
      balance: snapshot.balance,
      currency: snapshot.currency,
      balanceVersion: snapshot.balanceVersion,
    });
    this.applyBet({
      type: 'SNAPSHOT',
      roundId: snapshot.roundId,
      playerBet: snapshot.playerBet,
      lastSettledBet: snapshot.lastSettledBet,
    });

    const bet = this.stores.bet.getState();
    if (bet.status !== BetStatus.PLACING) this.timers.clear(this.betTimer);
    if (bet.status !== BetStatus.CASHING_OUT) this.timers.clear(this.cashoutTimer);
    if (snapshot.state === RoundState.RUNNING) this.audio.startFlightLoop();
    else this.audio.stopFlightLoop();
    this.publishUiState();
    this.events.emit('resynced', { reason: 'snapshot' });
  }

  private handlePong(message: PongMessage): void {
    const sentAt = this.pendingPings.get(message.requestId);
    if (sentAt === undefined) return;
    this.pendingPings.delete(message.requestId);
    this.clock.addPingSample(sentAt, message.serverTimestamp, this.clock.localTime());
    const rtt = this.clock.rttMs;
    if (rtt !== null) this.observeDelay(rtt / 2);
    this.stores.game.setState({ rttMs: rtt });
  }

  // ---------------------------------------------------------------- helpers

  /** Applies a bet event; returns whether it changed state. */
  private applyBet(event: BetEvent): boolean {
    const current = this.stores.bet.getState();
    const before = selectBetState(current);
    const next = reduceBet(before, event);
    if (next === before) return false;
    this.stores.bet.setState(next);
    return true;
  }

  /**
   * Tracks server->client delay (from tick age and ping RTT). Rises immediately when the
   * network gets slower and decays slowly, so the prediction lead adapts without flapping.
   */
  private observeDelay(delayMs: number): void {
    const delay = Math.max(0, delayMs);
    const current = this.delayEstimateMs;
    this.delayEstimateMs =
      current === null || delay > current ? delay : current + (delay - current) * 0.05;
    this.timeline.setOneWayDelay(this.delayEstimateMs);
  }

  private isStaleRound(roundId: string, serverTimestamp: number): boolean {
    if (this.retiredRounds.includes(roundId)) return true;
    const current = this.stores.game.getState().roundId;
    return roundId !== current && serverTimestamp < this.latestLifecycleTimestamp;
  }

  private retire(roundId: string): void {
    if (this.retiredRounds.includes(roundId)) return;
    this.retiredRounds.push(roundId);
    if (this.retiredRounds.length > MAX_RETIRED_ROUNDS) this.retiredRounds.shift();
  }

  private startPinging(): void {
    this.timers.clear(this.pingTimer);
    for (let i = 0; i < this.config.network.initialPingCount; i += 1) {
      this.timers.timeout(() => this.sendPing(), i * 150);
    }
    this.pingTimer = this.timers.interval(
      () => this.sendPing(),
      this.config.network.pingIntervalMs,
    );
  }

  private sendPing(): void {
    if (this.connection.status !== ConnectionStatus.CONNECTED) return;
    const requestId = this.createId('ping');
    const clientTimestamp = this.clock.localTime();
    if (this.pendingPings.size >= MAX_PENDING_PINGS) this.pendingPings.clear();
    this.pendingPings.set(requestId, clientTimestamp);
    this.connection.send({ type: 'PING', requestId, clientTimestamp });
  }

  /** Low-frequency bridge from the per-frame timeline to React state. */
  private publishUiState(): void {
    const game = this.stores.game.getState();
    const sample = this.timeline.sample(this.clock.serverNow(), this.uiSample);
    const patch: Partial<typeof game> = {};
    if (sample.phase === RoundState.RUNNING) {
      const display = floorMultiplier(sample.multiplier);
      if (display !== game.displayMultiplier) patch.displayMultiplier = display;
      this.audio.setFlightIntensity(sample.multiplier);
    }
    const countdown =
      sample.phase === RoundState.BETTING ? Math.ceil(sample.countdownMs / 100) * 100 : null;
    if (countdown !== game.bettingCountdownMs) patch.bettingCountdownMs = countdown;
    if (Object.keys(patch).length > 0) this.stores.game.setState(patch);
  }
}

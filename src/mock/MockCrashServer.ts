import { gameConfig } from '../config/gameConfig';
import { parseClientMessage } from '../network/messages';
import {
  PROTOCOL_VERSION,
  type BetRejectReason,
  type CashOutCommand,
  type CashoutRejectReason,
  type ClientMessage,
  type GameSnapshot,
  type PlaceBetCommand,
  type PlayerBetSnapshot,
  type ServerMessage,
} from '../network/protocol';
import type { BetLimits } from '../types/bet';
import { RoundState, type RoundResult } from '../types/game';
import { elapsedForMultiplier, floorMultiplier, multiplierAt } from '../utils/math';
import { applyMultiplier, type MinorUnits } from '../utils/money';
import { TimerGroup, type TimerHandle } from '../utils/timers';
import { devRandomCrashPoint } from './scenarios';

type MockServerConfig = typeof gameConfig.mockServer;

export interface MockServerOptions {
  config?: MockServerConfig;
  currency?: string;
  betLimits?: BetLimits;
  historyLength?: number;
  random?: () => number;
  /** Server wall clock (epoch ms), like a real backend. */
  now?: () => number;
}

export interface MockServerSession {
  /** Delivers a raw client frame to the server. */
  receive(raw: string): void;
  close(): void;
}

interface ServerRound {
  seq: number;
  roundId: string;
  state: RoundState;
  crashPoint: number;
  bettingEndsAt: number;
  startsAt: number | null;
  startedAt: number | null;
  crashAt: number | null;
  crashedAt: number | null;
  crashMultiplier: number | null;
}

interface ServerBet {
  roundId: string;
  betId: string;
  amount: MinorUnits;
  status: 'ACTIVE' | 'CASHED_OUT' | 'LOST';
  cashoutMultiplier: number | null;
  payout: MinorUnits | null;
}

type Sink = (message: ServerMessage) => void;

const BET_REJECT_TEXT: Record<BetRejectReason, string> = {
  ROUND_NOT_BETTING: 'Betting is closed for this round',
  WRONG_ROUND: 'Bet was sent for a different round',
  INVALID_AMOUNT: 'Invalid bet amount',
  INSUFFICIENT_FUNDS: 'Insufficient funds',
  ALREADY_PLACED: 'A bet is already placed for this round',
};

const CASHOUT_REJECT_TEXT: Record<CashoutRejectReason, string> = {
  ROUND_NOT_RUNNING: 'The round is not running',
  ROUND_CRASHED: 'Too late — the round already crashed',
  WRONG_ROUND: 'Cash-out was sent for a different round',
  NO_ACTIVE_BET: 'No active bet to cash out',
  ALREADY_CASHED_OUT: 'Already cashed out',
};

/**
 * In-memory stand-in for the real backend. It is authoritative for everything:
 * round timing, crash point, bet acceptance, cash-out and balance. The client only
 * talks to it through a Transport, exactly as it would talk to a real server.
 *
 * Single-player: every connected session shares one wallet.
 */
export class MockCrashServer {
  private readonly config: MockServerConfig;
  private readonly currency: string;
  private readonly betLimits: BetLimits;
  private readonly historyLength: number;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly timers = new TimerGroup();
  private readonly sinks = new Set<Sink>();
  private readonly processed = new Map<string, ServerMessage[]>();

  private round: ServerRound | null = null;
  private roundSeq = 1000;
  private betSeq = 0;
  private sessionSeq = 0;
  private phaseTimer: TimerHandle | null = null;
  private tickTimer: TimerHandle | null = null;
  private balance: MinorUnits;
  private balanceVersion = 0;
  private bet: ServerBet | null = null;
  private lastSettledBet: ServerBet | null = null;
  private history: RoundResult[] = [];
  private forcedCrashes: number[] = [];
  private running = false;

  constructor(options: MockServerOptions = {}) {
    this.config = options.config ?? gameConfig.mockServer;
    this.currency = options.currency ?? gameConfig.currency;
    this.betLimits = options.betLimits ?? {
      min: gameConfig.bet.minBet,
      max: gameConfig.bet.maxBet,
    };
    this.historyLength = options.historyLength ?? gameConfig.historyLength;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => Date.now());
    this.balance = this.config.initialBalance;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.beginBetting();
  }

  stop(): void {
    this.running = false;
    this.timers.clearAll();
    this.phaseTimer = null;
    this.tickTimer = null;
    this.sinks.clear();
  }

  connect(sink: Sink): MockServerSession {
    this.sinks.add(sink);
    this.sessionSeq += 1;
    sink({
      type: 'CONNECTED',
      serverTimestamp: this.now(),
      sessionId: `session-${this.sessionSeq}`,
      protocolVersion: PROTOCOL_VERSION,
    });
    return {
      receive: (raw) => {
        if (this.sinks.has(sink)) this.handleFrame(raw, sink);
      },
      close: () => {
        this.sinks.delete(sink);
      },
    };
  }

  // ---------- dev/test controls (never part of the client protocol) ----------

  forceNextCrash(multiplier: number): void {
    this.forcedCrashes.push(this.clampCrash(multiplier));
  }

  queueCrashes(points: readonly number[]): void {
    points.forEach((p) => this.forceNextCrash(p));
  }

  clearForcedCrashes(): void {
    this.forcedCrashes = [];
  }

  get forcedQueue(): readonly number[] {
    return this.forcedCrashes;
  }

  /** Skips the remaining wait of the current phase. */
  startNextRound(): void {
    const round = this.round;
    if (!round || !this.running) return;
    this.timers.clear(this.phaseTimer);
    switch (round.state) {
      case RoundState.BETTING:
        this.beginStarting();
        break;
      case RoundState.STARTING:
        this.beginRunning();
        break;
      case RoundState.CRASHED:
        this.finishRound();
        this.timers.clear(this.phaseTimer);
        this.beginBetting();
        break;
      case RoundState.IDLE:
        this.beginBetting();
        break;
      case RoundState.RUNNING:
        break;
    }
  }

  /** Crashes a running round immediately at its current multiplier. */
  forceCrash(): void {
    const round = this.round;
    if (!round || round.state !== RoundState.RUNNING) return;
    round.crashPoint = this.currentMultiplier(this.now());
    this.crash();
  }

  get roundState(): RoundState | null {
    return this.round?.state ?? null;
  }

  get currentRoundId(): string | null {
    return this.round?.roundId ?? null;
  }

  // ---------- round lifecycle ----------

  private beginBetting(): void {
    this.roundSeq += 1;
    const now = this.now();
    const round: ServerRound = {
      seq: this.roundSeq,
      roundId: `round-${this.roundSeq}`,
      state: RoundState.BETTING,
      crashPoint: this.forcedCrashes.shift() ?? this.randomCrashPoint(),
      bettingEndsAt: now + this.config.bettingDurationMs,
      startsAt: null,
      startedAt: null,
      crashAt: null,
      crashedAt: null,
      crashMultiplier: null,
    };
    this.round = round;
    this.bet = null;
    this.broadcast({
      type: 'BETTING_STARTED',
      serverTimestamp: now,
      roundId: round.roundId,
      bettingEndsAt: round.bettingEndsAt,
    });
    this.phaseTimer = this.timers.timeout(
      () => this.beginStarting(),
      this.config.bettingDurationMs,
    );
  }

  private beginStarting(): void {
    const round = this.requireRound(RoundState.BETTING);
    if (!round) return;
    const now = this.now();
    round.state = RoundState.STARTING;
    round.startsAt = now + this.config.startingDurationMs;
    this.broadcast({
      type: 'ROUND_STARTING',
      serverTimestamp: now,
      roundId: round.roundId,
      startsAt: round.startsAt,
    });
    this.phaseTimer = this.timers.timeout(
      () => this.beginRunning(),
      this.config.startingDurationMs,
    );
  }

  private beginRunning(): void {
    const round = this.requireRound(RoundState.STARTING);
    if (!round) return;
    const now = this.now();
    round.state = RoundState.RUNNING;
    round.startedAt = now;
    round.crashAt = now + elapsedForMultiplier(round.crashPoint, this.config.growthRate);
    this.broadcast({
      type: 'ROUND_STARTED',
      serverTimestamp: now,
      roundId: round.roundId,
      startedAt: now,
      growthRate: this.config.growthRate,
    });
    this.tickTimer = this.timers.interval(() => this.tick(), this.config.tickIntervalMs);
    this.phaseTimer = this.timers.timeout(() => this.crash(), round.crashAt - now);
  }

  private tick(): void {
    const round = this.round;
    if (!round || round.state !== RoundState.RUNNING || round.startedAt === null) return;
    const now = this.now();
    if (round.crashAt !== null && now >= round.crashAt) {
      this.crash();
      return;
    }
    this.broadcast({
      type: 'ROUND_TICK',
      serverTimestamp: now,
      roundId: round.roundId,
      elapsedMs: now - round.startedAt,
      multiplier: this.currentMultiplier(now),
    });
  }

  private crash(): void {
    const round = this.round;
    if (!round || round.state !== RoundState.RUNNING) return;
    this.timers.clear(this.tickTimer);
    this.timers.clear(this.phaseTimer);
    this.tickTimer = null;
    const now = this.now();
    round.state = RoundState.CRASHED;
    round.crashedAt = now;
    round.crashMultiplier = round.crashPoint;

    if (this.bet && this.bet.roundId === round.roundId) {
      if (this.bet.status === 'ACTIVE') this.bet.status = 'LOST';
      this.lastSettledBet = { ...this.bet };
    }
    this.history = [
      { roundId: round.roundId, crashMultiplier: round.crashPoint },
      ...this.history,
    ].slice(0, this.historyLength);

    this.broadcast({
      type: 'ROUND_CRASHED',
      serverTimestamp: now,
      roundId: round.roundId,
      crashMultiplier: round.crashPoint,
      crashedAt: now,
    });
    this.phaseTimer = this.timers.timeout(() => {
      this.finishRound();
      this.phaseTimer = this.timers.timeout(() => this.beginBetting(), this.config.idleDurationMs);
    }, this.config.postCrashDelayMs);
  }

  private finishRound(): void {
    const round = this.round;
    if (!round || round.state !== RoundState.CRASHED) return;
    round.state = RoundState.IDLE;
    this.broadcast({
      type: 'ROUND_FINISHED',
      serverTimestamp: this.now(),
      roundId: round.roundId,
      recentRounds: [...this.history],
    });
  }

  // ---------- commands ----------

  private handleFrame(raw: string, sink: Sink): void {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      sink({
        type: 'ERROR',
        serverTimestamp: this.now(),
        code: 'BAD_REQUEST',
        message: parsed.error,
        requestId: null,
      });
      return;
    }
    this.handleCommand(parsed.value, sink);
  }

  private handleCommand(command: ClientMessage, sink: Sink): void {
    switch (command.type) {
      case 'PING':
        sink({
          type: 'PONG',
          serverTimestamp: this.now(),
          requestId: command.requestId,
          clientTimestamp: command.clientTimestamp,
        });
        return;
      case 'REQUEST_SNAPSHOT':
        sink({
          type: 'SNAPSHOT',
          serverTimestamp: this.now(),
          requestId: command.requestId,
          snapshot: this.createSnapshot(),
        });
        return;
      case 'PLACE_BET':
      case 'CASH_OUT': {
        // Idempotency: a retried request id gets the original responses, never a second debit.
        const cached = this.processed.get(command.requestId);
        if (cached) {
          cached.forEach((message) => sink(message));
          return;
        }
        const responses =
          command.type === 'PLACE_BET' ? this.placeBet(command) : this.cashOut(command);
        this.remember(command.requestId, responses);
        responses.forEach((message) =>
          message.type === 'BALANCE_UPDATED' ? this.broadcast(message) : sink(message),
        );
        return;
      }
    }
  }

  private placeBet(command: PlaceBetCommand): ServerMessage[] {
    const round = this.round;
    const now = this.now();
    const reject = (reason: BetRejectReason): ServerMessage[] => [
      {
        type: 'BET_REJECTED',
        serverTimestamp: now,
        requestId: command.requestId,
        roundId: command.roundId,
        reason,
        message: BET_REJECT_TEXT[reason],
      },
    ];
    if (!round || round.roundId !== command.roundId) return reject('WRONG_ROUND');
    if (round.state !== RoundState.BETTING || now >= round.bettingEndsAt) {
      return reject('ROUND_NOT_BETTING');
    }
    if (this.bet && this.bet.roundId === round.roundId) return reject('ALREADY_PLACED');
    const amount = command.amount;
    if (
      !Number.isSafeInteger(amount) ||
      amount < this.betLimits.min ||
      amount > this.betLimits.max
    ) {
      return reject('INVALID_AMOUNT');
    }
    if (amount > this.balance) return reject('INSUFFICIENT_FUNDS');

    this.betSeq += 1;
    this.bet = {
      roundId: round.roundId,
      betId: `bet-${round.seq}-${this.betSeq}`,
      amount,
      status: 'ACTIVE',
      cashoutMultiplier: null,
      payout: null,
    };
    this.balance -= amount;
    this.balanceVersion += 1;
    return [
      {
        type: 'BET_ACCEPTED',
        serverTimestamp: now,
        requestId: command.requestId,
        roundId: round.roundId,
        betId: this.bet.betId,
        amount,
      },
      this.balanceMessage(now),
    ];
  }

  private cashOut(command: CashOutCommand): ServerMessage[] {
    const round = this.round;
    const now = this.now();
    const reject = (reason: CashoutRejectReason): ServerMessage[] => [
      {
        type: 'CASHOUT_REJECTED',
        serverTimestamp: now,
        requestId: command.requestId,
        roundId: command.roundId,
        reason,
        message: CASHOUT_REJECT_TEXT[reason],
      },
    ];
    if (!round || round.roundId !== command.roundId) return reject('WRONG_ROUND');
    const bet = this.bet;
    if (!bet || bet.roundId !== round.roundId || bet.betId !== command.betId) {
      return reject('NO_ACTIVE_BET');
    }
    if (bet.status === 'CASHED_OUT') return reject('ALREADY_CASHED_OUT');
    if (round.state === RoundState.RUNNING && round.crashAt !== null && now >= round.crashAt) {
      // The crash timer has not fired yet but the round is already over.
      this.crash();
    }
    if (round.state === RoundState.CRASHED || round.state === RoundState.IDLE) {
      return reject('ROUND_CRASHED');
    }
    if (round.state !== RoundState.RUNNING) return reject('ROUND_NOT_RUNNING');

    const multiplier = this.currentMultiplier(now);
    const payout = applyMultiplier(bet.amount, multiplier);
    bet.status = 'CASHED_OUT';
    bet.cashoutMultiplier = multiplier;
    bet.payout = payout;
    this.balance += payout;
    this.balanceVersion += 1;
    return [
      {
        type: 'CASHOUT_ACCEPTED',
        serverTimestamp: now,
        requestId: command.requestId,
        roundId: round.roundId,
        betId: bet.betId,
        multiplier,
        payout,
      },
      this.balanceMessage(now),
    ];
  }

  // ---------- helpers ----------

  createSnapshot(): GameSnapshot {
    const now = this.now();
    const round = this.round;
    if (!round) throw new Error('MockCrashServer: snapshot requested before start()');
    const crashed = round.state === RoundState.CRASHED || round.state === RoundState.IDLE;
    return {
      roundId: round.roundId,
      state: round.state,
      serverTime: now,
      bettingEndsAt: round.bettingEndsAt,
      startsAt: round.startsAt,
      roundStartedAt: round.startedAt,
      growthRate: this.config.growthRate,
      currentMultiplier: this.currentMultiplier(now),
      // The crash point is secret until the round has actually crashed.
      crashMultiplier: crashed ? round.crashMultiplier : null,
      crashedAt: crashed ? round.crashedAt : null,
      playerBet: this.bet && this.bet.roundId === round.roundId ? toSnapshot(this.bet) : null,
      lastSettledBet: this.lastSettledBet ? toSnapshot(this.lastSettledBet) : null,
      balance: this.balance,
      balanceVersion: this.balanceVersion,
      currency: this.currency,
      recentRounds: [...this.history],
      betLimits: { ...this.betLimits },
    };
  }

  private currentMultiplier(now: number): number {
    const round = this.round;
    if (!round) return 1;
    if (round.state === RoundState.RUNNING && round.startedAt !== null) {
      const m = floorMultiplier(multiplierAt(now - round.startedAt, this.config.growthRate));
      return Math.max(1, Math.min(m, round.crashPoint));
    }
    if (round.crashMultiplier !== null) return round.crashMultiplier;
    return 1;
  }

  private balanceMessage(now: number): ServerMessage {
    return {
      type: 'BALANCE_UPDATED',
      serverTimestamp: now,
      balance: this.balance,
      currency: this.currency,
      version: this.balanceVersion,
    };
  }

  private broadcast(message: ServerMessage): void {
    this.sinks.forEach((sink) => sink(message));
  }

  private remember(requestId: string, responses: ServerMessage[]): void {
    this.processed.set(requestId, responses);
    if (this.processed.size > this.config.idempotencyCacheSize) {
      const oldest = this.processed.keys().next().value;
      if (oldest !== undefined) this.processed.delete(oldest);
    }
  }

  private requireRound(state: RoundState): ServerRound | null {
    return this.round && this.round.state === state ? this.round : null;
  }

  private randomCrashPoint(): number {
    return devRandomCrashPoint(this.random, this.config.maxCrashMultiplier);
  }

  private clampCrash(multiplier: number): number {
    return Math.min(this.config.maxCrashMultiplier, Math.max(1, floorMultiplier(multiplier)));
  }
}

function toSnapshot(bet: ServerBet): PlayerBetSnapshot {
  return {
    roundId: bet.roundId,
    betId: bet.betId,
    amount: bet.amount,
    status: bet.status,
    cashoutMultiplier: bet.cashoutMultiplier,
    payout: bet.payout,
  };
}

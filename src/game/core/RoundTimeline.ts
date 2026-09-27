import { gameConfig } from '../../config/gameConfig';
import type { GameSnapshot } from '../../network/protocol';
import { RoundState } from '../../types/game';
import { elapsedForMultiplier, multiplierAt } from '../../utils/math';

export interface TimelineSample {
  phase: RoundState;
  roundId: string | null;
  /** Visual elapsed time, consistent with `multiplier`. */
  elapsedMs: number;
  /** Continuous display multiplier (floor to 2 decimals for text). */
  multiplier: number;
  growthRate: number;
  /** Remaining time of BETTING/STARTING, 0 otherwise. */
  countdownMs: number;
  countdownTotalMs: number;
  crashMultiplier: number | null;
  /** Time since the authoritative crash (server clock); Infinity when not crashed. */
  msSinceCrash: number;
  /** True while the prediction is held back waiting for fresh server ticks. */
  stalled: boolean;
}

export function createTimelineSample(): TimelineSample {
  return {
    phase: RoundState.IDLE,
    roundId: null,
    elapsedMs: 0,
    multiplier: 1,
    growthRate: gameConfig.mockServer.growthRate,
    countdownMs: 0,
    countdownTotalMs: 0,
    crashMultiplier: null,
    msSinceCrash: Infinity,
    stalled: false,
  };
}

/** Read-only view handed to the rendering layer. */
export interface RoundTimelineReader {
  sample(serverNow: number, out: TimelineSample): TimelineSample;
}

type TimelineOptions = typeof gameConfig.timeline;

/**
 * Authoritative round timing, written by GameController from server messages and read by
 * the renderer every frame. The display multiplier is a pure function of (server time,
 * round start, growth rate), capped so it never runs far ahead of the last server tick.
 * It therefore stays correct at any frame rate, after a background tab, or after resync.
 */
export class RoundTimeline implements RoundTimelineReader {
  private phase: RoundState = RoundState.IDLE;
  private roundId: string | null = null;
  private growthRate: number = gameConfig.mockServer.growthRate;
  private countdownEndsAt: number | null = null;
  private countdownTotalMs = 0;
  private startedAt: number | null = null;
  private lastTickElapsedMs = 0;
  private lastTickMultiplier = 1;
  private crashMultiplier: number | null = null;
  private crashedAt: number | null = null;
  private maxLeadMs: number;

  constructor(private readonly options: TimelineOptions = gameConfig.timeline) {
    this.maxLeadMs = options.minTickLeadMs;
  }

  get currentPhase(): RoundState {
    return this.phase;
  }

  get currentRoundId(): string | null {
    return this.roundId;
  }

  /**
   * Allowed prediction lead grows with the measured server->client delay, so high-latency
   * play stays smooth instead of constantly waiting for ticks that are known to be late.
   */
  setOneWayDelay(delayMs: number): void {
    this.maxLeadMs = Math.max(
      this.options.minTickLeadMs,
      Math.max(0, delayMs) + this.options.tickLeadMarginMs,
    );
  }

  reset(): void {
    this.phase = RoundState.IDLE;
    this.roundId = null;
    this.countdownEndsAt = null;
    this.countdownTotalMs = 0;
    this.startedAt = null;
    this.lastTickElapsedMs = 0;
    this.lastTickMultiplier = 1;
    this.crashMultiplier = null;
    this.crashedAt = null;
  }

  setBetting(roundId: string, bettingEndsAt: number, serverTimestamp: number): void {
    this.reset();
    this.phase = RoundState.BETTING;
    this.roundId = roundId;
    this.countdownEndsAt = bettingEndsAt;
    this.countdownTotalMs = Math.max(0, bettingEndsAt - serverTimestamp);
  }

  setStarting(roundId: string, startsAt: number, serverTimestamp: number): void {
    this.phase = RoundState.STARTING;
    this.roundId = roundId;
    this.countdownEndsAt = startsAt;
    this.countdownTotalMs = Math.max(0, startsAt - serverTimestamp);
  }

  setRunning(
    roundId: string,
    startedAt: number,
    growthRate: number,
    serverTimestamp: number,
  ): void {
    this.phase = RoundState.RUNNING;
    this.roundId = roundId;
    this.startedAt = startedAt;
    this.growthRate = growthRate;
    this.countdownEndsAt = null;
    this.crashMultiplier = null;
    this.crashedAt = null;
    this.lastTickElapsedMs = Math.max(0, serverTimestamp - startedAt);
    this.lastTickMultiplier = 1;
  }

  applyTick(elapsedMs: number, multiplier: number): void {
    if (this.phase !== RoundState.RUNNING) return;
    if (elapsedMs < this.lastTickElapsedMs) return;
    this.lastTickElapsedMs = elapsedMs;
    this.lastTickMultiplier = Math.max(this.lastTickMultiplier, multiplier);
  }

  setCrashed(roundId: string, crashMultiplier: number, crashedAt: number): void {
    this.phase = RoundState.CRASHED;
    this.roundId = roundId;
    this.crashMultiplier = crashMultiplier;
    this.crashedAt = crashedAt;
    this.countdownEndsAt = null;
  }

  setIdle(roundId: string): void {
    this.phase = RoundState.IDLE;
    this.roundId = roundId;
    this.countdownEndsAt = null;
  }

  restore(snapshot: GameSnapshot): void {
    this.reset();
    this.roundId = snapshot.roundId;
    this.growthRate = snapshot.growthRate;
    switch (snapshot.state) {
      case RoundState.BETTING:
        if (snapshot.bettingEndsAt !== null) {
          this.setBetting(snapshot.roundId, snapshot.bettingEndsAt, snapshot.serverTime);
        }
        break;
      case RoundState.STARTING:
        if (snapshot.startsAt !== null) {
          this.setStarting(snapshot.roundId, snapshot.startsAt, snapshot.serverTime);
        }
        break;
      case RoundState.RUNNING:
        if (snapshot.roundStartedAt !== null) {
          this.setRunning(
            snapshot.roundId,
            snapshot.roundStartedAt,
            snapshot.growthRate,
            snapshot.serverTime,
          );
          this.applyTick(snapshot.serverTime - snapshot.roundStartedAt, snapshot.currentMultiplier);
        }
        break;
      case RoundState.CRASHED:
      case RoundState.IDLE:
        this.startedAt = snapshot.roundStartedAt;
        if (snapshot.crashMultiplier !== null) {
          this.setCrashed(snapshot.roundId, snapshot.crashMultiplier, snapshot.crashedAt ?? 0);
        }
        if (snapshot.state === RoundState.IDLE) this.setIdle(snapshot.roundId);
        break;
    }
    this.phase = snapshot.state;
  }

  sample(serverNow: number, out: TimelineSample = createTimelineSample()): TimelineSample {
    out.phase = this.phase;
    out.roundId = this.roundId;
    out.growthRate = this.growthRate;
    out.crashMultiplier = this.crashMultiplier;
    out.countdownTotalMs = this.countdownTotalMs;
    out.countdownMs =
      this.countdownEndsAt === null ? 0 : Math.max(0, this.countdownEndsAt - serverNow);
    out.msSinceCrash = this.crashedAt === null ? Infinity : Math.max(0, serverNow - this.crashedAt);
    out.stalled = false;

    if (this.phase === RoundState.RUNNING && this.startedAt !== null) {
      const rawElapsed = Math.max(0, serverNow - this.startedAt);
      const cap = this.lastTickElapsedMs + this.maxLeadMs;
      let elapsed = Math.min(rawElapsed, cap);
      const tickFloor = elapsedForMultiplier(this.lastTickMultiplier, this.growthRate);
      if (tickFloor > elapsed) elapsed = tickFloor;
      out.elapsedMs = elapsed;
      out.multiplier = multiplierAt(elapsed, this.growthRate);
      out.stalled = rawElapsed > cap;
    } else if (this.crashMultiplier !== null) {
      out.multiplier = this.crashMultiplier;
      out.elapsedMs = elapsedForMultiplier(this.crashMultiplier, this.growthRate);
    } else {
      out.multiplier = 1;
      out.elapsedMs = 0;
    }
    return out;
  }
}

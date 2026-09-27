import { gameConfig } from '../../config/gameConfig';
import { clamp } from '../../utils/math';
import { monotonicNow, type TimeSource } from '../../utils/time';

interface ClockSample {
  offset: number;
  rtt: number;
}

type ClockOptions = typeof gameConfig.clock;

/**
 * Separates three notions of time:
 *  - local monotonic time (performance.now)
 *  - estimated server time (local + offset learned from PING/PONG)
 *  - round elapsed time (server time - authoritative round start)
 *
 * Offset corrections are slewed (applied gradually) so the estimated server clock never
 * jumps backwards by small amounts, which would make the multiplier visibly stutter.
 */
export class GameClock {
  private samples: ClockSample[] = [];
  private roughOffset: number | null = null;
  private appliedOffset = 0;
  private hasApplied = false;
  private lastLocal: number;

  constructor(
    private readonly localNow: TimeSource = monotonicNow,
    private readonly options: ClockOptions = gameConfig.clock,
  ) {
    this.lastLocal = localNow();
  }

  localTime(): number {
    return this.localNow();
  }

  get isSynced(): boolean {
    return this.samples.length > 0 || this.roughOffset !== null;
  }

  /** Best round-trip time seen recently, or null before the first PONG. */
  get rttMs(): number | null {
    if (this.samples.length === 0) return null;
    return Math.min(...this.samples.map((s) => s.rtt));
  }

  /** Target offset: the lowest-RTT ping sample is the most accurate. */
  get targetOffset(): number | null {
    if (this.samples.length > 0) {
      let best = this.samples[0] as ClockSample;
      for (const s of this.samples) if (s.rtt < best.rtt) best = s;
      return best.offset;
    }
    return this.roughOffset;
  }

  /**
   * Coarse sync from any server-stamped message (ignores latency). Used only until a
   * proper PING/PONG sample exists. Server time appears "behind" by the one-way latency,
   * so the largest estimate is the least wrong.
   */
  observeServerTimestamp(serverTimestamp: number, receivedAt: number = this.localNow()): void {
    if (this.samples.length > 0) return;
    const estimate = serverTimestamp - receivedAt;
    this.roughOffset = this.roughOffset === null ? estimate : Math.max(this.roughOffset, estimate);
  }

  /** NTP-style sample: assumes symmetric latency. */
  addPingSample(clientSentAt: number, serverTimestamp: number, receivedAt: number): void {
    const rtt = Math.max(0, receivedAt - clientSentAt);
    const offset = serverTimestamp - (clientSentAt + rtt / 2);
    this.samples.push({ offset, rtt });
    if (this.samples.length > this.options.sampleWindow) this.samples.shift();
  }

  serverNow(): number {
    const local = this.localNow();
    const target = this.targetOffset;
    if (target !== null) {
      const diff = target - this.appliedOffset;
      if (!this.hasApplied || Math.abs(diff) > this.options.hardSyncThresholdMs) {
        this.appliedOffset = target;
        this.hasApplied = true;
      } else {
        const maxStep = Math.max(0, local - this.lastLocal) * this.options.slewRate;
        this.appliedOffset += clamp(diff, -maxStep, maxStep);
      }
    }
    this.lastLocal = local;
    return local + this.appliedOffset;
  }

  roundElapsed(roundStartedAt: number): number {
    return this.serverNow() - roundStartedAt;
  }

  /** Forget samples (e.g. after reconnecting to a possibly different server). */
  reset(): void {
    this.samples = [];
    this.roughOffset = null;
  }
}

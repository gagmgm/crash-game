import { TimerGroup, type TimerHandle } from '../utils/timers';

export interface ReconnectionOptions {
  baseDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
  /** +/- fraction of randomness so many clients don't reconnect in lockstep. */
  jitterRatio: number;
}

/** Exponential backoff with jitter. Knows nothing about sockets; it only schedules attempts. */
export class ReconnectionManager {
  private attemptCount = 0;
  private handle: TimerHandle | null = null;
  private readonly timers = new TimerGroup();

  constructor(
    private readonly options: ReconnectionOptions,
    private readonly random: () => number = Math.random,
  ) {}

  get attempts(): number {
    return this.attemptCount;
  }

  get isScheduled(): boolean {
    return this.handle !== null;
  }

  get exhausted(): boolean {
    return this.attemptCount >= this.options.maxAttempts;
  }

  delayForAttempt(attempt: number): number {
    const exp = Math.min(this.options.maxDelayMs, this.options.baseDelayMs * 2 ** attempt);
    const jitter = 1 + (this.random() * 2 - 1) * this.options.jitterRatio;
    return Math.round(Math.min(this.options.maxDelayMs, exp * jitter));
  }

  /** Schedules the next attempt. Returns false when the attempt budget is exhausted. */
  schedule(attempt: () => void): boolean {
    this.cancel();
    if (this.exhausted) return false;
    const delay = this.delayForAttempt(this.attemptCount);
    this.attemptCount += 1;
    this.handle = this.timers.timeout(() => {
      this.handle = null;
      attempt();
    }, delay);
    return true;
  }

  cancel(): void {
    this.timers.clear(this.handle);
    this.handle = null;
  }

  /** Call after a successful connection. */
  reset(): void {
    this.cancel();
    this.attemptCount = 0;
  }

  dispose(): void {
    this.timers.clearAll();
    this.handle = null;
  }
}

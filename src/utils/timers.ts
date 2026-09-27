type Handle = ReturnType<typeof setTimeout>;

/**
 * Owns a group of timeouts/intervals so an owner can release all of them in one call
 * on dispose. Prevents the classic "timer fires after unmount" leaks.
 */
export class TimerGroup {
  private readonly timeouts = new Set<Handle>();
  private readonly intervals = new Set<Handle>();

  timeout(callback: () => void, delayMs: number): Handle {
    const handle = setTimeout(
      () => {
        this.timeouts.delete(handle);
        callback();
      },
      Math.max(0, delayMs),
    );
    this.timeouts.add(handle);
    return handle;
  }

  interval(callback: () => void, periodMs: number): Handle {
    const handle = setInterval(callback, periodMs);
    this.intervals.add(handle);
    return handle;
  }

  clear(handle: Handle | null | undefined): void {
    if (handle === null || handle === undefined) return;
    if (this.timeouts.delete(handle)) clearTimeout(handle);
    if (this.intervals.delete(handle)) clearInterval(handle);
  }

  clearAll(): void {
    this.timeouts.forEach((h) => clearTimeout(h));
    this.intervals.forEach((h) => clearInterval(h));
    this.timeouts.clear();
    this.intervals.clear();
  }

  get size(): number {
    return this.timeouts.size + this.intervals.size;
  }
}

export type TimerHandle = Handle;

import { vi } from 'vitest';

export function useFakeClock(): void {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
    now: 1_700_000_000_000,
  });
}

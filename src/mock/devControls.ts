import type { MockCrashServer } from './MockCrashServer';
import type { MockTransport } from './MockTransport';
import { findScenario } from './scenarios';

/**
 * MOCK/TEST ONLY. Controls exposed to the DevPanel. These bypass the game protocol on
 * purpose and do not exist when a real backend is used.
 */
export interface MockDevControls {
  forceNextCrash(multiplier: number): void;
  queueScenario(id: string): void;
  clearForcedCrashes(): void;
  forcedQueue(): readonly number[];
  startNextRound(): void;
  forceCrash(): void;
  setLatency(ms: number): void;
  latency(): number;
  setDropRate(rate: number): void;
  dropRate(): number;
  goOffline(): void;
  goOnline(): void;
  isOffline(): boolean;
}

export function createMockDevControls(
  server: MockCrashServer,
  transport: MockTransport,
): MockDevControls {
  return {
    forceNextCrash: (m) => server.forceNextCrash(m),
    queueScenario: (id) => {
      const scenario = findScenario(id);
      if (scenario) server.queueCrashes(scenario.crashPoints);
    },
    clearForcedCrashes: () => server.clearForcedCrashes(),
    forcedQueue: () => server.forcedQueue,
    startNextRound: () => server.startNextRound(),
    forceCrash: () => server.forceCrash(),
    setLatency: (ms) => transport.setLatency(ms),
    latency: () => transport.conditions.latencyMs,
    setDropRate: (rate) => transport.setDropRate(rate),
    dropRate: () => transport.conditions.dropRate,
    goOffline: () => transport.goOffline(),
    goOnline: () => transport.goOnline(),
    isOffline: () => transport.conditions.offline,
  };
}

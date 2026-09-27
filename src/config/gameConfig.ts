import type { MinorUnits } from '../utils/money';

/**
 * Client configuration. Round durations and bet limits here are only *defaults* used
 * by the mock server and before the first snapshot; a real backend dictates them.
 */
const config = {
  currency: 'USD',
  historyLength: 20,

  bet: {
    minBet: 10 as MinorUnits, // 0.10
    maxBet: 100_000 as MinorUnits, // 1000.00
    defaultBet: 1_000 as MinorUnits, // 10.00
    quickAdd: [100, 500, 1_000] as MinorUnits[], // +1, +5, +10
  },

  network: {
    /** Pending bet/cash-out without a response after this long triggers a snapshot resync. */
    requestTimeoutMs: 6_000,
    snapshotTimeoutMs: 6_000,
    pingIntervalMs: 5_000,
    initialPingCount: 3,
    reconnect: {
      baseDelayMs: 500,
      maxDelayMs: 8_000,
      maxAttempts: 30,
      jitterRatio: 0.2,
    },
    /** A page hidden for longer than this resyncs from a snapshot on return. */
    visibilityResyncAfterMs: 2_000,
    /** Mock transport is used unless a real endpoint is configured. */
    websocketUrl: (import.meta.env.VITE_WS_URL as string | undefined) ?? '',
  },

  clock: {
    /** Max rate at which the estimated server clock is slewed (fraction of real time). */
    slewRate: 0.1,
    /** Offset corrections larger than this are applied immediately instead of slewed. */
    hardSyncThresholdMs: 500,
    sampleWindow: 8,
  },

  timeline: {
    /** How far the displayed multiplier may run ahead of the last authoritative tick. */
    minTickLeadMs: 400,
    tickLeadMarginMs: 300,
  },

  ui: {
    /** React receives throttled multiplier/countdown updates; Pixi renders every frame. */
    storeUpdateIntervalMs: 100,
  },

  mockServer: {
    initialBalance: 100_000 as MinorUnits, // 1000.00
    bettingDurationMs: 5_000,
    startingDurationMs: 1_000,
    postCrashDelayMs: 3_000,
    idleDurationMs: 800,
    tickIntervalMs: 100,
    growthRate: 0.00006, // per ms: 2x ~11.5s, 10x ~38s, 100x ~77s
    maxCrashMultiplier: 1_000,
    idempotencyCacheSize: 200,
  },

  mockNetwork: {
    latencyOptionsMs: [0, 100, 300, 500, 1_000, 2_000],
    dropRateOptions: [0, 0.05, 0.2],
    connectDelayMs: 150,
  },

  graph: {
    minVisibleMultiplier: 2,
    minVisibleTimeMs: 10_000,
    headroomMultiplier: 1.25,
    headroomTime: 1.2,
    /** Exponential smoothing strength for axis range changes (per second). */
    rangeSmoothing: 3.5,
    curveSegments: 90,
    maxYTicks: 5,
    maxXTicks: 6,
    lineWidth: 4,
  },

  animation: {
    maxFrameDtMs: 100,
    aircraftRotationSmoothing: 10,
    aircraftTangentLookbackMs: 400,
    crashParticleCount: 48,
    crashEffectDurationMs: 1_200,
    /** Crash explosion plays only if the crash happened this recently (not on late resync). */
    crashEffectMaxAgeMs: 1_500,
    backgroundStarCount: 70,
  },

  render: {
    maxDevicePixelRatio: 2,
    backgroundColor: 0x0b0f1a,
  },
};

type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};

export type GameConfig = DeepReadonly<typeof config>;
export const gameConfig: GameConfig = config;

import { ROUND_STATES, type RoundResult, type RoundState } from '../types/game';
import type { ClientMessage, GameSnapshot, PlayerBetSnapshot, ServerMessage } from './protocol';

/**
 * Runtime validation for everything crossing the network boundary. Messages are
 * untrusted input: a malformed frame is rejected here instead of crashing the app.
 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

type Obj = Record<string, unknown>;

class ValidationError extends Error {}

function fail(message: string): never {
  throw new ValidationError(message);
}

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(o: Obj, key: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0) fail(`${key} must be a non-empty string`);
  return v;
}

function num(o: Obj, key: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${key} must be a finite number`);
  return v;
}

function int(o: Obj, key: string): number {
  const v = num(o, key);
  if (!Number.isSafeInteger(v) || v < 0) fail(`${key} must be a non-negative integer`);
  return v;
}

function multiplier(o: Obj, key: string): number {
  const v = num(o, key);
  if (v < 1) fail(`${key} must be >= 1`);
  return v;
}

function nullable<T>(o: Obj, key: string, read: (o: Obj, key: string) => T): T | null {
  return o[key] === null || o[key] === undefined ? null : read(o, key);
}

function oneOf<T extends string>(o: Obj, key: string, values: readonly T[]): T {
  const v = o[key];
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) {
    fail(`${key} has unexpected value`);
  }
  return v as T;
}

function obj(o: Obj, key: string): Obj {
  const v = o[key];
  if (!isObj(v)) fail(`${key} must be an object`);
  return v;
}

function roundResults(o: Obj, key: string): RoundResult[] {
  const v = o[key];
  if (!Array.isArray(v)) fail(`${key} must be an array`);
  return v.map((item: unknown) => {
    if (!isObj(item)) fail(`${key} entry must be an object`);
    return { roundId: str(item, 'roundId'), crashMultiplier: multiplier(item, 'crashMultiplier') };
  });
}

const BET_SNAPSHOT_STATUSES = ['ACTIVE', 'CASHED_OUT', 'LOST'] as const;

function playerBet(o: Obj, key: string): PlayerBetSnapshot | null {
  if (o[key] === null || o[key] === undefined) return null;
  const b = obj(o, key);
  return {
    roundId: str(b, 'roundId'),
    betId: str(b, 'betId'),
    amount: int(b, 'amount'),
    status: oneOf(b, 'status', BET_SNAPSHOT_STATUSES),
    cashoutMultiplier: nullable(b, 'cashoutMultiplier', multiplier),
    payout: nullable(b, 'payout', int),
  };
}

function snapshot(o: Obj): GameSnapshot {
  const limits = obj(o, 'betLimits');
  return {
    roundId: str(o, 'roundId'),
    state: oneOf<RoundState>(o, 'state', ROUND_STATES),
    serverTime: num(o, 'serverTime'),
    bettingEndsAt: nullable(o, 'bettingEndsAt', num),
    startsAt: nullable(o, 'startsAt', num),
    roundStartedAt: nullable(o, 'roundStartedAt', num),
    growthRate: num(o, 'growthRate'),
    currentMultiplier: multiplier(o, 'currentMultiplier'),
    crashMultiplier: nullable(o, 'crashMultiplier', multiplier),
    crashedAt: nullable(o, 'crashedAt', num),
    playerBet: playerBet(o, 'playerBet'),
    lastSettledBet: playerBet(o, 'lastSettledBet'),
    balance: int(o, 'balance'),
    balanceVersion: int(o, 'balanceVersion'),
    currency: str(o, 'currency'),
    recentRounds: roundResults(o, 'recentRounds'),
    betLimits: { min: int(limits, 'min'), max: int(limits, 'max') },
  };
}

function parseServerObject(o: Obj): ServerMessage {
  const type = str(o, 'type');
  const serverTimestamp = num(o, 'serverTimestamp');
  switch (type) {
    case 'CONNECTED':
      return {
        type,
        serverTimestamp,
        sessionId: str(o, 'sessionId'),
        protocolVersion: int(o, 'protocolVersion'),
      };
    case 'SNAPSHOT':
      return {
        type,
        serverTimestamp,
        requestId: nullable(o, 'requestId', str),
        snapshot: snapshot(obj(o, 'snapshot')),
      };
    case 'BETTING_STARTED':
      return {
        type,
        serverTimestamp,
        roundId: str(o, 'roundId'),
        bettingEndsAt: num(o, 'bettingEndsAt'),
      };
    case 'ROUND_STARTING':
      return { type, serverTimestamp, roundId: str(o, 'roundId'), startsAt: num(o, 'startsAt') };
    case 'ROUND_STARTED':
      return {
        type,
        serverTimestamp,
        roundId: str(o, 'roundId'),
        startedAt: num(o, 'startedAt'),
        growthRate: num(o, 'growthRate'),
      };
    case 'ROUND_TICK':
      return {
        type,
        serverTimestamp,
        roundId: str(o, 'roundId'),
        elapsedMs: num(o, 'elapsedMs'),
        multiplier: multiplier(o, 'multiplier'),
      };
    case 'ROUND_CRASHED':
      return {
        type,
        serverTimestamp,
        roundId: str(o, 'roundId'),
        crashMultiplier: multiplier(o, 'crashMultiplier'),
        crashedAt: num(o, 'crashedAt'),
      };
    case 'ROUND_FINISHED':
      return {
        type,
        serverTimestamp,
        roundId: str(o, 'roundId'),
        recentRounds: roundResults(o, 'recentRounds'),
      };
    case 'BET_ACCEPTED':
      return {
        type,
        serverTimestamp,
        requestId: str(o, 'requestId'),
        roundId: str(o, 'roundId'),
        betId: str(o, 'betId'),
        amount: int(o, 'amount'),
      };
    case 'BET_REJECTED':
      return {
        type,
        serverTimestamp,
        requestId: str(o, 'requestId'),
        roundId: str(o, 'roundId'),
        reason: oneOf(o, 'reason', [
          'ROUND_NOT_BETTING',
          'WRONG_ROUND',
          'INVALID_AMOUNT',
          'INSUFFICIENT_FUNDS',
          'ALREADY_PLACED',
        ] as const),
        message: str(o, 'message'),
      };
    case 'CASHOUT_ACCEPTED':
      return {
        type,
        serverTimestamp,
        requestId: str(o, 'requestId'),
        roundId: str(o, 'roundId'),
        betId: str(o, 'betId'),
        multiplier: multiplier(o, 'multiplier'),
        payout: int(o, 'payout'),
      };
    case 'CASHOUT_REJECTED':
      return {
        type,
        serverTimestamp,
        requestId: str(o, 'requestId'),
        roundId: str(o, 'roundId'),
        reason: oneOf(o, 'reason', [
          'ROUND_NOT_RUNNING',
          'ROUND_CRASHED',
          'WRONG_ROUND',
          'NO_ACTIVE_BET',
          'ALREADY_CASHED_OUT',
        ] as const),
        message: str(o, 'message'),
      };
    case 'BALANCE_UPDATED':
      return {
        type,
        serverTimestamp,
        balance: int(o, 'balance'),
        currency: str(o, 'currency'),
        version: int(o, 'version'),
      };
    case 'PONG':
      return {
        type,
        serverTimestamp,
        requestId: str(o, 'requestId'),
        clientTimestamp: num(o, 'clientTimestamp'),
      };
    case 'ERROR':
      return {
        type,
        serverTimestamp,
        code: str(o, 'code'),
        message: str(o, 'message'),
        requestId: nullable(o, 'requestId', str),
      };
    default:
      return fail(`unknown message type "${type}"`);
  }
}

function parseClientObject(o: Obj): ClientMessage {
  const type = str(o, 'type');
  switch (type) {
    case 'PLACE_BET':
      return {
        type,
        requestId: str(o, 'requestId'),
        roundId: str(o, 'roundId'),
        amount: num(o, 'amount'),
      };
    case 'CASH_OUT':
      return {
        type,
        requestId: str(o, 'requestId'),
        roundId: str(o, 'roundId'),
        betId: str(o, 'betId'),
      };
    case 'REQUEST_SNAPSHOT':
      return { type, requestId: str(o, 'requestId') };
    case 'PING':
      return { type, requestId: str(o, 'requestId'), clientTimestamp: num(o, 'clientTimestamp') };
    default:
      return fail(`unknown command type "${type}"`);
  }
}

function parseWith<T>(raw: string, parseObject: (o: Obj) => T): ParseResult<T> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  if (!isObj(data)) return { ok: false, error: 'message must be a JSON object' };
  try {
    return { ok: true, value: parseObject(data) };
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, error: err.message };
    throw err;
  }
}

export function parseServerMessage(raw: string): ParseResult<ServerMessage> {
  return parseWith(raw, parseServerObject);
}

export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  return parseWith(raw, parseClientObject);
}

export function serializeMessage(message: ServerMessage | ClientMessage): string {
  return JSON.stringify(message);
}

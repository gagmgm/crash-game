import type { RoundResult, RoundState } from '../types/game';
import type { BetLimits } from '../types/bet';
import type { MinorUnits } from '../utils/money';

export const PROTOCOL_VERSION = 1;

/** All server timestamps are milliseconds on the server's clock. */
type ServerStamped = { serverTimestamp: number };

export interface PlayerBetSnapshot {
  roundId: string;
  betId: string;
  amount: MinorUnits;
  status: 'ACTIVE' | 'CASHED_OUT' | 'LOST';
  cashoutMultiplier: number | null;
  payout: MinorUnits | null;
}

/** Everything a client needs to rebuild its visible state after (re)connecting. */
export interface GameSnapshot {
  roundId: string;
  state: RoundState;
  serverTime: number;
  bettingEndsAt: number | null;
  startsAt: number | null;
  roundStartedAt: number | null;
  growthRate: number;
  /** Authoritative multiplier at `serverTime` (1 before the round runs). */
  currentMultiplier: number;
  /** Only present once the round has crashed; never leaked earlier. */
  crashMultiplier: number | null;
  crashedAt: number | null;
  playerBet: PlayerBetSnapshot | null;
  /** Most recent settled bet of a previous round (lets a reconnecting client learn its outcome). */
  lastSettledBet: PlayerBetSnapshot | null;
  balance: MinorUnits;
  balanceVersion: number;
  currency: string;
  recentRounds: RoundResult[];
  betLimits: BetLimits;
}

export type BetRejectReason =
  'ROUND_NOT_BETTING' | 'WRONG_ROUND' | 'INVALID_AMOUNT' | 'INSUFFICIENT_FUNDS' | 'ALREADY_PLACED';

export type CashoutRejectReason =
  'ROUND_NOT_RUNNING' | 'ROUND_CRASHED' | 'WRONG_ROUND' | 'NO_ACTIVE_BET' | 'ALREADY_CASHED_OUT';

// ---------- Server -> Client ----------

export interface ConnectedMessage extends ServerStamped {
  type: 'CONNECTED';
  sessionId: string;
  protocolVersion: number;
}
export interface SnapshotMessage extends ServerStamped {
  type: 'SNAPSHOT';
  requestId: string | null;
  snapshot: GameSnapshot;
}
export interface BettingStartedMessage extends ServerStamped {
  type: 'BETTING_STARTED';
  roundId: string;
  bettingEndsAt: number;
}
export interface RoundStartingMessage extends ServerStamped {
  type: 'ROUND_STARTING';
  roundId: string;
  startsAt: number;
}
export interface RoundStartedMessage extends ServerStamped {
  type: 'ROUND_STARTED';
  roundId: string;
  startedAt: number;
  growthRate: number;
}
export interface RoundTickMessage extends ServerStamped {
  type: 'ROUND_TICK';
  roundId: string;
  elapsedMs: number;
  multiplier: number;
}
export interface RoundCrashedMessage extends ServerStamped {
  type: 'ROUND_CRASHED';
  roundId: string;
  crashMultiplier: number;
  crashedAt: number;
}
export interface RoundFinishedMessage extends ServerStamped {
  type: 'ROUND_FINISHED';
  roundId: string;
  recentRounds: RoundResult[];
}
export interface BetAcceptedMessage extends ServerStamped {
  type: 'BET_ACCEPTED';
  requestId: string;
  roundId: string;
  betId: string;
  amount: MinorUnits;
}
export interface BetRejectedMessage extends ServerStamped {
  type: 'BET_REJECTED';
  requestId: string;
  roundId: string;
  reason: BetRejectReason;
  message: string;
}
export interface CashoutAcceptedMessage extends ServerStamped {
  type: 'CASHOUT_ACCEPTED';
  requestId: string;
  roundId: string;
  betId: string;
  multiplier: number;
  payout: MinorUnits;
}
export interface CashoutRejectedMessage extends ServerStamped {
  type: 'CASHOUT_REJECTED';
  requestId: string;
  roundId: string;
  reason: CashoutRejectReason;
  message: string;
}
export interface BalanceUpdatedMessage extends ServerStamped {
  type: 'BALANCE_UPDATED';
  balance: MinorUnits;
  currency: string;
  /** Monotonic per-wallet version, used to drop out-of-order balance updates. */
  version: number;
}
export interface PongMessage extends ServerStamped {
  type: 'PONG';
  requestId: string;
  clientTimestamp: number;
}
export interface ErrorMessage extends ServerStamped {
  type: 'ERROR';
  code: string;
  message: string;
  requestId: string | null;
}

export type ServerMessage =
  | ConnectedMessage
  | SnapshotMessage
  | BettingStartedMessage
  | RoundStartingMessage
  | RoundStartedMessage
  | RoundTickMessage
  | RoundCrashedMessage
  | RoundFinishedMessage
  | BetAcceptedMessage
  | BetRejectedMessage
  | CashoutAcceptedMessage
  | CashoutRejectedMessage
  | BalanceUpdatedMessage
  | PongMessage
  | ErrorMessage;

export type ServerMessageType = ServerMessage['type'];

export type RoundLifecycleMessage =
  | BettingStartedMessage
  | RoundStartingMessage
  | RoundStartedMessage
  | RoundCrashedMessage
  | RoundFinishedMessage;

// ---------- Client -> Server ----------

export interface PlaceBetCommand {
  type: 'PLACE_BET';
  requestId: string;
  roundId: string;
  amount: MinorUnits;
}
export interface CashOutCommand {
  type: 'CASH_OUT';
  requestId: string;
  roundId: string;
  betId: string;
}
export interface RequestSnapshotCommand {
  type: 'REQUEST_SNAPSHOT';
  requestId: string;
}
export interface PingCommand {
  type: 'PING';
  requestId: string;
  clientTimestamp: number;
}

export type ClientMessage = PlaceBetCommand | CashOutCommand | RequestSnapshotCommand | PingCommand;
export type ClientMessageType = ClientMessage['type'];

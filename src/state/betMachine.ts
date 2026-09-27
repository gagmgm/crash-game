import { BetStatus, type BetResult } from '../types/bet';
import { RoundState } from '../types/game';
import type { PlayerBetSnapshot } from '../network/protocol';
import type { MinorUnits } from '../utils/money';

export interface BetState {
  status: BetStatus;
  roundId: string | null;
  betId: string | null;
  requestId: string | null;
  cashoutRequestId: string | null;
  /** Amount of the pending/accepted bet (authoritative once ACTIVE). */
  amount: MinorUnits | null;
  cashoutMultiplier: number | null;
  payout: MinorUnits | null;
  /** Human-readable reason for the latest rejection or notice. */
  message: string | null;
  /** Bet from a previous round whose outcome we have not seen yet. */
  unresolvedRoundId: string | null;
  lastResult: BetResult | null;
}

export const initialBetState: BetState = {
  status: BetStatus.NONE,
  roundId: null,
  betId: null,
  requestId: null,
  cashoutRequestId: null,
  amount: null,
  cashoutMultiplier: null,
  payout: null,
  message: null,
  unresolvedRoundId: null,
  lastResult: null,
};

export type BetEvent =
  | { type: 'PLACE_REQUESTED'; requestId: string; roundId: string; amount: MinorUnits }
  | { type: 'BET_ACCEPTED'; requestId: string; roundId: string; betId: string; amount: MinorUnits }
  | { type: 'BET_REJECTED'; requestId: string; reason: string }
  | { type: 'CASHOUT_REQUESTED'; requestId: string }
  | {
      type: 'CASHOUT_ACCEPTED';
      requestId: string;
      roundId: string;
      betId: string;
      multiplier: number;
      payout: MinorUnits;
    }
  | { type: 'CASHOUT_REJECTED'; requestId: string; reason: string; roundRunning: boolean }
  | { type: 'ROUND_CRASHED'; roundId: string }
  | { type: 'NEW_ROUND'; roundId: string }
  | {
      type: 'SNAPSHOT';
      roundId: string;
      playerBet: PlayerBetSnapshot | null;
      lastSettledBet: PlayerBetSnapshot | null;
    };

const PENDING_OR_LIVE: readonly BetStatus[] = [
  BetStatus.PLACING,
  BetStatus.ACTIVE,
  BetStatus.CASHING_OUT,
];

export function isBetLive(status: BetStatus): boolean {
  return PENDING_OR_LIVE.includes(status);
}

function resultFromSnapshot(bet: PlayerBetSnapshot): BetResult | null {
  if (bet.status === 'ACTIVE') return null;
  return {
    roundId: bet.roundId,
    outcome: bet.status,
    amount: bet.amount,
    cashoutMultiplier: bet.cashoutMultiplier,
    payout: bet.payout,
  };
}

/**
 * Pure reducer for the bet lifecycle. Returns the *same object* when an event does not
 * apply (wrong state, unknown requestId, stale round), so callers can detect ignored events.
 */
export function reduceBet(state: BetState, event: BetEvent): BetState {
  switch (event.type) {
    case 'PLACE_REQUESTED': {
      if (state.status !== BetStatus.NONE && state.status !== BetStatus.REJECTED) return state;
      return {
        ...initialBetState,
        lastResult: state.lastResult,
        unresolvedRoundId: state.unresolvedRoundId,
        status: BetStatus.PLACING,
        roundId: event.roundId,
        requestId: event.requestId,
        amount: event.amount,
      };
    }

    case 'BET_ACCEPTED': {
      if (state.status !== BetStatus.PLACING || state.requestId !== event.requestId) return state;
      if (state.roundId !== event.roundId) return state;
      return {
        ...state,
        status: BetStatus.ACTIVE,
        betId: event.betId,
        amount: event.amount,
        message: null,
      };
    }

    case 'BET_REJECTED': {
      if (state.status !== BetStatus.PLACING || state.requestId !== event.requestId) return state;
      return { ...state, status: BetStatus.REJECTED, message: event.reason };
    }

    case 'CASHOUT_REQUESTED': {
      if (state.status !== BetStatus.ACTIVE) return state;
      return { ...state, status: BetStatus.CASHING_OUT, cashoutRequestId: event.requestId };
    }

    case 'CASHOUT_ACCEPTED': {
      // ACTIVE is accepted too: a snapshot may have reverted CASHING_OUT before the
      // (authoritative) acceptance for our own request arrived.
      const statusOk = state.status === BetStatus.CASHING_OUT || state.status === BetStatus.ACTIVE;
      if (!statusOk || state.cashoutRequestId !== event.requestId) return state;
      if (state.roundId !== event.roundId || state.betId !== event.betId) return state;
      return {
        ...state,
        status: BetStatus.CASHED_OUT,
        cashoutMultiplier: event.multiplier,
        payout: event.payout,
        message: null,
        lastResult: {
          roundId: event.roundId,
          outcome: 'CASHED_OUT',
          amount: state.amount ?? 0,
          cashoutMultiplier: event.multiplier,
          payout: event.payout,
        },
      };
    }

    case 'CASHOUT_REJECTED': {
      if (state.status !== BetStatus.CASHING_OUT || state.cashoutRequestId !== event.requestId) {
        return state;
      }
      if (event.roundRunning) {
        return { ...state, status: BetStatus.ACTIVE, message: event.reason };
      }
      return {
        ...state,
        status: BetStatus.LOST,
        message: event.reason,
        lastResult: lostResult(state),
      };
    }

    case 'ROUND_CRASHED': {
      // A pending CASHING_OUT is left alone: the server may have accepted it before the crash.
      if (state.status !== BetStatus.ACTIVE || state.roundId !== event.roundId) return state;
      return { ...state, status: BetStatus.LOST, lastResult: lostResult(state) };
    }

    case 'NEW_ROUND': {
      if (state.roundId === event.roundId) return state;
      if (state.status === BetStatus.NONE && state.message === null) return state;
      const unresolved = isBetLive(state.status) ? state.roundId : state.unresolvedRoundId;
      return { ...initialBetState, lastResult: state.lastResult, unresolvedRoundId: unresolved };
    }

    case 'SNAPSHOT':
      return reduceSnapshot(state, event.roundId, event.playerBet, event.lastSettledBet);
  }
}

function lostResult(state: BetState): BetResult {
  return {
    roundId: state.roundId ?? '',
    outcome: 'LOST',
    amount: state.amount ?? 0,
    cashoutMultiplier: null,
    payout: null,
  };
}

/** A snapshot is authoritative: the local bet is rebuilt entirely from the server's view. */
function reduceSnapshot(
  state: BetState,
  roundId: string,
  playerBet: PlayerBetSnapshot | null,
  lastSettledBet: PlayerBetSnapshot | null,
): BetState {
  let lastResult = state.lastResult;
  let unresolvedRoundId = state.unresolvedRoundId;
  if (state.roundId !== null && state.roundId !== roundId && isBetLive(state.status)) {
    unresolvedRoundId = state.roundId;
  }
  if (lastSettledBet && lastSettledBet.roundId === unresolvedRoundId) {
    lastResult = resultFromSnapshot(lastSettledBet) ?? lastResult;
    unresolvedRoundId = null;
  }

  const currentBet = playerBet && playerBet.roundId === roundId ? playerBet : null;
  if (currentBet) {
    const sameBet = state.roundId === roundId;
    const settled = resultFromSnapshot(currentBet);
    return {
      status: BetStatus[currentBet.status],
      roundId,
      betId: currentBet.betId,
      requestId: sameBet ? state.requestId : null,
      cashoutRequestId: sameBet ? state.cashoutRequestId : null,
      amount: currentBet.amount,
      cashoutMultiplier: currentBet.cashoutMultiplier,
      payout: currentBet.payout,
      message: null,
      unresolvedRoundId,
      lastResult: settled ?? lastResult,
    };
  }

  const lostPendingBet = state.roundId === roundId && isBetLive(state.status);
  const keepRejection = state.roundId === roundId && state.status === BetStatus.REJECTED;
  return {
    ...initialBetState,
    status: keepRejection ? BetStatus.REJECTED : BetStatus.NONE,
    roundId: keepRejection ? roundId : null,
    message: lostPendingBet
      ? 'The server has no record of this bet.'
      : keepRejection
        ? state.message
        : null,
    unresolvedRoundId,
    lastResult,
  };
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

export interface ActionContext {
  connected: boolean;
  syncing: boolean;
  roundState: RoundState;
  roundId: string | null;
}

export function canPlaceBet(
  bet: BetState,
  ctx: ActionContext,
  amount: MinorUnits,
  limits: { min: MinorUnits; max: MinorUnits },
  balance: MinorUnits | null,
): GuardResult {
  if (!ctx.connected) return { ok: false, reason: 'Not connected' };
  if (ctx.syncing) return { ok: false, reason: 'Synchronizing with server' };
  if (ctx.roundState !== RoundState.BETTING || !ctx.roundId) {
    return { ok: false, reason: 'Betting is closed' };
  }
  if (bet.status !== BetStatus.NONE && bet.status !== BetStatus.REJECTED) {
    return { ok: false, reason: 'A bet is already in progress' };
  }
  if (!Number.isSafeInteger(amount) || amount < limits.min) {
    return { ok: false, reason: 'Amount is below the minimum bet' };
  }
  if (amount > limits.max) return { ok: false, reason: 'Amount exceeds the maximum bet' };
  // UX hint only; the server performs the real balance check.
  if (balance !== null && amount > balance) return { ok: false, reason: 'Insufficient balance' };
  return { ok: true };
}

export function canCashOut(bet: BetState, ctx: ActionContext): GuardResult {
  if (!ctx.connected) return { ok: false, reason: 'Not connected' };
  if (ctx.syncing) return { ok: false, reason: 'Synchronizing with server' };
  if (bet.status !== BetStatus.ACTIVE) return { ok: false, reason: 'No active bet' };
  if (ctx.roundState !== RoundState.RUNNING || ctx.roundId !== bet.roundId) {
    return { ok: false, reason: 'Round is not running' };
  }
  return { ok: true };
}

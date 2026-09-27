import type { BetState } from '../../state/betMachine';
import { BetStatus } from '../../types/bet';
import { RoundState } from '../../types/game';
import { applyMultiplier, formatMoney, type MinorUnits } from '../../utils/money';
import styles from './BetPanel.module.css';

interface Props {
  bet: BetState;
  roundState: RoundState;
  displayMultiplier: number;
  countdownMs: number | null;
  currency: string;
}

/** Bet / multiplier / potential. "Potential" is a display estimate, never a payout. */
export function BetSummary({ bet, roundState, displayMultiplier, countdownMs, currency }: Props) {
  const money = (v: MinorUnits) => formatMoney(v, currency);
  const hasBet =
    bet.amount !== null && bet.status !== BetStatus.NONE && bet.status !== BetStatus.REJECTED;
  const running = roundState === RoundState.RUNNING;
  const live = bet.status === BetStatus.ACTIVE || bet.status === BetStatus.CASHING_OUT;

  let multiplierText = '—';
  if (running) multiplierText = `${displayMultiplier.toFixed(2)}x`;
  else if (roundState === RoundState.BETTING && countdownMs !== null) {
    multiplierText = `in ${(countdownMs / 1000).toFixed(1)}s`;
  } else if (roundState === RoundState.CRASHED || roundState === RoundState.IDLE) {
    multiplierText = `${displayMultiplier.toFixed(2)}x`;
  }

  let potential = '—';
  if (bet.status === BetStatus.CASHED_OUT && bet.payout !== null) potential = money(bet.payout);
  else if (hasBet && live && running && bet.amount !== null) {
    potential = `≈ ${money(applyMultiplier(bet.amount, displayMultiplier))}`;
  }

  const { text: note, tone } = describe(bet, money);

  return (
    <div className={`${styles.section} ${styles.summarySection}`}>
      <div className={styles.summary}>
        <div className={styles.stat}>
          <span className={styles.label}>BET</span>
          <span className={styles.statValue}>
            {hasBet && bet.amount !== null ? money(bet.amount) : '—'}
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.label}>
            {running ? 'MULTIPLIER' : roundState === RoundState.BETTING ? 'LAUNCH' : 'LAST'}
          </span>
          <span className={styles.statValue}>{multiplierText}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.label}>
            {bet.status === BetStatus.CASHED_OUT ? 'PAYOUT' : 'POTENTIAL'}
          </span>
          <span className={styles.statValue}>{potential}</span>
        </div>
      </div>
      <div className={styles.note} data-tone={tone} aria-live="polite">
        {note}
      </div>
    </div>
  );
}

function describe(
  bet: BetState,
  money: (v: MinorUnits) => string,
): { text: string; tone: 'error' | 'success' | 'info' } {
  switch (bet.status) {
    case BetStatus.REJECTED:
      return { text: `Bet rejected: ${bet.message ?? 'unknown reason'}`, tone: 'error' };
    case BetStatus.PLACING:
      return { text: 'Bet sent — waiting for the server to accept it…', tone: 'info' };
    case BetStatus.CASHING_OUT:
      return { text: 'Cash-out sent — waiting for server confirmation…', tone: 'info' };
    case BetStatus.CASHED_OUT:
      return {
        text: `Server confirmed cash-out at ${bet.cashoutMultiplier?.toFixed(2)}x (${money(bet.payout ?? 0)})`,
        tone: 'success',
      };
    case BetStatus.LOST:
      return {
        text: bet.message ? `Lost — ${bet.message}` : 'Crashed before cash-out',
        tone: 'error',
      };
    case BetStatus.ACTIVE:
      return bet.message
        ? { text: `Cash-out rejected: ${bet.message}`, tone: 'error' }
        : { text: 'Bet accepted by server', tone: 'info' };
    case BetStatus.NONE: {
      if (bet.message) return { text: bet.message, tone: 'error' };
      if (bet.unresolvedRoundId) return { text: 'Confirming previous round result…', tone: 'info' };
      const last = bet.lastResult;
      if (!last) return { text: '', tone: 'info' };
      return last.outcome === 'CASHED_OUT'
        ? {
            text: `Last round: won ${money(last.payout ?? 0)} at ${last.cashoutMultiplier?.toFixed(2)}x`,
            tone: 'success',
          }
        : { text: `Last round: lost ${money(last.amount)}`, tone: 'error' };
    }
  }
}

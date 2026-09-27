import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useBetStore, useGameSession, useGameStore, usePlayerStore } from '../../app/session';
import { isBetLive } from '../../state/betMachine';
import { selectBetState } from '../../store/betStore';
import { selectActionContext } from '../../store/selectors';
import { AmountInput } from './AmountInput';
import { getBetButtonModel } from './betButtonModel';
import { BetSummary } from './BetSummary';
import styles from './BetPanel.module.css';

export function BetPanel() {
  const { controller } = useGameSession();
  const betStore = useBetStore(useShallow((s) => s));
  const bet = selectBetState(betStore);
  const game = useGameStore(
    useShallow((s) => ({
      connectionStatus: s.connectionStatus,
      syncing: s.syncing,
      roundState: s.roundState,
      roundId: s.roundId,
      betLimits: s.betLimits,
      displayMultiplier: s.displayMultiplier,
      bettingCountdownMs: s.bettingCountdownMs,
    })),
  );
  const ctx = selectActionContext(game);
  const { balance, currency } = usePlayerStore(
    useShallow((s) => ({ balance: s.balance, currency: s.currency })),
  );

  const model = getBetButtonModel({
    bet,
    ctx,
    inputAmount: betStore.inputAmount,
    limits: game.betLimits,
    balance,
    displayMultiplier: game.displayMultiplier,
    currency,
  });

  const runAction = () => {
    if (model.action === 'bet') controller.placeBet();
    else if (model.action === 'cashout') controller.cashOut();
  };

  // Space bar = primary action (unless typing in a field). Ref keeps the listener stable.
  const actionRef = useRef(runAction);
  useEffect(() => {
    actionRef.current = runAction;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(target.tagName)) return;
      event.preventDefault();
      actionRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <section className={styles.panel} aria-label="Bet panel">
      <AmountInput
        amount={betStore.inputAmount}
        currency={currency}
        limits={game.betLimits}
        balance={balance}
        disabled={isBetLive(bet.status)}
        onChange={betStore.setInputAmount}
      />
      <BetSummary
        bet={bet}
        roundState={game.roundState}
        displayMultiplier={game.displayMultiplier}
        countdownMs={game.bettingCountdownMs}
        currency={currency}
      />
      <div className={styles.section}>
        <button
          type="button"
          className={`${styles.main} ${styles[model.variant] ?? ''}`}
          disabled={model.disabled}
          onClick={runAction}
          aria-describedby="bet-button-sub"
        >
          {model.label}
          {model.sublabel && <small id="bet-button-sub">{model.sublabel}</small>}
        </button>
      </div>
    </section>
  );
}

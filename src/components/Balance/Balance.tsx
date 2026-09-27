import { useShallow } from 'zustand/react/shallow';
import { usePlayerStore } from '../../app/session';
import { formatMoney } from '../../utils/money';
import styles from './Balance.module.css';

/** Shows the server-reported balance; never computed client-side. */
export function Balance() {
  const { balance, currency } = usePlayerStore(
    useShallow((s) => ({ balance: s.balance, currency: s.currency })),
  );
  return (
    <div className={styles.balance} aria-live="polite">
      <span className={styles.label}>BALANCE</span>
      <span className={styles.value}>
        {balance === null ? '—' : formatMoney(balance, currency)}
      </span>
    </div>
  );
}

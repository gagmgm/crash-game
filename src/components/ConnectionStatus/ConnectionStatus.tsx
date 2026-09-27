import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '../../app/session';
import { ConnectionStatus as Status } from '../../types/network';
import styles from './ConnectionStatus.module.css';

const LABELS: Record<Status, string> = {
  DISCONNECTED: 'Offline',
  CONNECTING: 'Connecting',
  CONNECTED: 'Online',
  RECONNECTING: 'Reconnecting',
  ERROR: 'Connection failed',
};

export function ConnectionStatus() {
  const { status, rttMs } = useGameStore(
    useShallow((s) => ({ status: s.connectionStatus, rttMs: s.rttMs })),
  );
  return (
    <div
      className={`${styles.status} ${styles[status] ?? ''}`}
      role="status"
      title={`Connection: ${status}`}
    >
      <span className={styles.dot} />
      <span className={styles.label}>
        {LABELS[status]}
        {status === Status.CONNECTED && rttMs !== null ? ` · ${Math.round(rttMs)}ms` : ''}
      </span>
    </div>
  );
}

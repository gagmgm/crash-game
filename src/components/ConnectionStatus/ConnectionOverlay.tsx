import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '../../app/session';
import { ConnectionStatus } from '../../types/network';
import styles from './ConnectionStatus.module.css';

/** HTML overlay over the canvas while the client cannot trust its local state. */
export function ConnectionOverlay() {
  const { status, syncing } = useGameStore(
    useShallow((s) => ({ status: s.connectionStatus, syncing: s.syncing })),
  );
  let message: string | null = null;
  if (status === ConnectionStatus.CONNECTING) message = 'Connecting to server…';
  else if (status === ConnectionStatus.RECONNECTING) message = 'Connection lost — reconnecting…';
  else if (status === ConnectionStatus.ERROR) message = 'Unable to reach the server';
  else if (status === ConnectionStatus.DISCONNECTED) message = 'Disconnected';
  else if (syncing) message = 'Synchronizing…';
  if (!message) return null;
  return (
    <div className={styles.overlay} aria-live="assertive">
      <div className={styles.overlayCard}>
        {status !== ConnectionStatus.ERROR && <span className={styles.spinner} />}
        {message}
      </div>
    </div>
  );
}

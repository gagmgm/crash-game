import { memo } from 'react';
import { useGameStore } from '../../app/session';
import styles from './History.module.css';

function tier(multiplier: number): string {
  if (multiplier < 2) return styles.low ?? '';
  if (multiplier < 10) return styles.mid ?? '';
  if (multiplier < 50) return styles.high ?? '';
  return styles.huge ?? '';
}

/** Recent crash points exactly as reported by the server (snapshot / round events). */
export const History = memo(function History() {
  const rounds = useGameStore((s) => s.recentRounds);
  if (rounds.length === 0) {
    return <div className={styles.empty}>No rounds yet</div>;
  }
  return (
    <ol className={styles.history} aria-label="Recent crash multipliers" style={{ margin: 0 }}>
      {rounds.map((round, index) => (
        <li
          key={round.roundId}
          className={`${styles.chip} ${tier(round.crashMultiplier)} ${index === 0 ? styles.fresh : ''}`}
          title={round.roundId}
          style={{ listStyle: 'none' }}
        >
          {round.crashMultiplier.toFixed(2)}x
        </li>
      ))}
    </ol>
  );
});

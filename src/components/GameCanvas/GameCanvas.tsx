import { useEffect, useRef, useState } from 'react';
import { useGameSession } from '../../app/session';
import { CrashGame } from '../../game/CrashGame';
import { createLogger } from '../../utils/logger';
import styles from './GameCanvas.module.css';

const logger = createLogger('canvas');

/**
 * Mounts the PixiJS game into a div. React only controls the lifecycle; it never touches
 * Pixi objects. Each mount creates exactly one CrashGame and destroys it on unmount, so
 * StrictMode's mount/unmount/mount leaves a single running instance.
 */
export function GameCanvas() {
  const { timeline, clock, events } = useGameSession();
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const game = new CrashGame({ timeline, clock, events });
    game
      .init(host)
      .then(() => game.start())
      .catch((error: unknown) => {
        logger.error('failed to initialise renderer', error);
        setFailed(true);
      });
    return () => game.destroy();
  }, [timeline, clock, events]);

  return (
    <>
      <div ref={hostRef} className={styles.host} />
      {failed && (
        <div className={styles.error} role="alert">
          Graphics could not be initialised (WebGL unavailable). Betting still works.
        </div>
      )}
    </>
  );
}

import { useEffect, useState } from 'react';
import { createGameSession } from './createGameSession';
import { GameLayout } from './GameLayout';
import { GameSessionContext } from './session';

export function App() {
  // One session per App instance. Creating it has no side effects, so the extra
  // initializer call React makes in StrictMode is harmless; the effect owns start/stop.
  const [session] = useState(createGameSession);

  useEffect(() => {
    session.start();
    return () => session.stop();
  }, [session]);

  return (
    <GameSessionContext value={session}>
      <GameLayout />
    </GameSessionContext>
  );
}

import { useState } from 'react';
import { useGameSession } from './session';

export function MuteButton({ className }: { className?: string }) {
  const { audio } = useGameSession();
  const [muted, setMuted] = useState(audio.muted);
  const toggle = () => {
    if (muted) audio.unmute();
    else audio.mute();
    setMuted(!muted);
  };
  return (
    <button
      type="button"
      className={className}
      onClick={toggle}
      aria-pressed={muted}
      aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
      title={muted ? 'Unmute' : 'Mute'}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}

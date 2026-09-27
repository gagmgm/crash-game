import { createLogger } from '../utils/logger';

/** What the game needs from audio. Implementations may be silent. */
export interface GameAudio {
  readonly muted: boolean;
  roundStart(): void;
  betAccepted(): void;
  cashout(): void;
  crash(): void;
  startFlightLoop(): void;
  stopFlightLoop(): void;
  setFlightIntensity(multiplier: number): void;
  mute(): void;
  unmute(): void;
}

export const silentAudio: GameAudio = {
  muted: true,
  roundStart: () => {},
  betAccepted: () => {},
  cashout: () => {},
  crash: () => {},
  startFlightLoop: () => {},
  stopFlightLoop: () => {},
  setFlightIntensity: () => {},
  mute: () => {},
  unmute: () => {},
};

const STORAGE_KEY = 'crash.muted';
const logger = createLogger('audio');

/**
 * Placeholder synthesized sounds via Web Audio (no asset files yet). Browsers block audio
 * until a user gesture, so the AudioContext is only created/resumed from the first
 * pointer/key event after `attach()`. Swap the synth calls for sampled assets later.
 */
export class AudioManager implements GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private flight: { osc: OscillatorNode; gain: GainNode } | null = null;
  private flightWanted = false;
  private isMuted: boolean;
  private attached = false;

  constructor() {
    this.isMuted = readStoredMute();
  }

  get muted(): boolean {
    return this.isMuted;
  }

  /** Starts listening for the unlock gesture. Safe to call repeatedly. */
  attach(): void {
    if (this.attached || typeof window === 'undefined') return;
    this.attached = true;
    window.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
  }

  detach(): void {
    this.attached = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this.unlock);
      window.removeEventListener('keydown', this.unlock);
    }
    this.stopFlightLoop();
    void this.context?.close().catch(() => {});
    this.context = null;
    this.master = null;
  }

  mute(): void {
    this.isMuted = true;
    writeStoredMute(true);
    if (this.master) this.master.gain.value = 0;
  }

  unmute(): void {
    this.isMuted = false;
    writeStoredMute(false);
    if (this.master) this.master.gain.value = 0.25;
  }

  roundStart(): void {
    this.tone(440, 0.12, 'triangle');
    this.tone(660, 0.12, 'triangle', 0.1);
  }

  betAccepted(): void {
    this.tone(880, 0.08, 'sine');
  }

  cashout(): void {
    this.tone(660, 0.1, 'sine');
    this.tone(990, 0.16, 'sine', 0.08);
  }

  crash(): void {
    this.tone(140, 0.45, 'sawtooth');
    this.tone(90, 0.5, 'square', 0.05);
  }

  startFlightLoop(): void {
    this.flightWanted = true;
    const ctx = this.context;
    if (!ctx || !this.master || this.flight) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 110;
    gain.gain.value = 0.04;
    osc.connect(gain).connect(this.master);
    osc.start();
    this.flight = { osc, gain };
  }

  stopFlightLoop(): void {
    this.flightWanted = false;
    if (!this.flight) return;
    try {
      this.flight.osc.stop();
    } catch {
      // already stopped
    }
    this.flight.osc.disconnect();
    this.flight.gain.disconnect();
    this.flight = null;
  }

  setFlightIntensity(multiplier: number): void {
    if (!this.flight || !this.context) return;
    const freq = 110 + Math.min(500, Math.log(Math.max(1, multiplier)) * 120);
    this.flight.osc.frequency.setTargetAtTime(freq, this.context.currentTime, 0.1);
  }

  private readonly unlock = (): void => {
    if (typeof AudioContext === 'undefined') return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.isMuted ? 0 : 0.25;
        this.master.connect(this.context.destination);
      }
      void this.context.resume().then(() => {
        if (this.flightWanted) this.startFlightLoop();
      });
      window.removeEventListener('pointerdown', this.unlock);
      window.removeEventListener('keydown', this.unlock);
    } catch (error) {
      logger.warn('audio unavailable', error);
    }
  };

  private tone(freq: number, duration: number, type: OscillatorType, delay = 0): void {
    const ctx = this.context;
    if (!ctx || !this.master || this.isMuted || ctx.state !== 'running') return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.5, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
}

function readStoredMute(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStoredMute(muted: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // storage unavailable (private mode, sandboxed iframe)
  }
}

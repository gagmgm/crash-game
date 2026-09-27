import type { Container } from 'pixi.js';
import { RoundState } from '../../types/game';
import type { BaseScene, FrameInfo, SceneKey } from '../scenes/BaseScene';
import type { Layout } from './layout';
import type { TimelineSample } from './RoundTimeline';

/** Maps authoritative round phases to visual scenes. */
export function sceneForSample(sample: TimelineSample): SceneKey {
  switch (sample.phase) {
    case RoundState.RUNNING:
      return 'running';
    case RoundState.CRASHED:
      return 'crashed';
    case RoundState.IDLE:
      // Post-round idle keeps showing the crash; a fresh client with no round shows the lobby.
      return sample.crashMultiplier !== null ? 'crashed' : 'betting';
    case RoundState.BETTING:
    case RoundState.STARTING:
      return 'betting';
  }
}

export class SceneManager {
  private readonly scenes = new Map<SceneKey, BaseScene>();
  private currentKey: SceneKey | null = null;
  private currentRoundId: string | null = null;

  constructor(private readonly overlayParent: Container) {}

  register(key: SceneKey, scene: BaseScene): void {
    this.scenes.set(key, scene);
    this.overlayParent.addChild(scene.root);
  }

  get activeKey(): SceneKey | null {
    return this.currentKey;
  }

  /** Switches scene when the phase maps to a different scene or a different round began. */
  sync(sample: TimelineSample): void {
    const key = sceneForSample(sample);
    if (key === this.currentKey && sample.roundId === this.currentRoundId) return;
    const previousKey = this.currentKey;
    if (previousKey) {
      const previous = this.scenes.get(previousKey);
      previous?.exit();
      if (previous) previous.root.visible = false;
    }
    const next = this.scenes.get(key);
    this.currentKey = key;
    this.currentRoundId = sample.roundId;
    if (next) {
      next.root.visible = true;
      next.enter(sample, previousKey === key ? null : previousKey);
    }
  }

  update(sample: TimelineSample, frame: FrameInfo): void {
    if (this.currentKey) this.scenes.get(this.currentKey)?.update(sample, frame);
  }

  resize(layout: Layout): void {
    this.scenes.forEach((scene) => scene.resize(layout));
  }

  destroy(): void {
    this.scenes.forEach((scene) => scene.destroy());
    this.scenes.clear();
    this.currentKey = null;
  }
}

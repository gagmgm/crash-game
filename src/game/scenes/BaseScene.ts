import { Container } from 'pixi.js';
import type { AircraftAnimator } from '../animation/AircraftAnimator';
import type { GraphAnimator } from '../animation/GraphAnimator';
import type { Layout } from '../core/layout';
import type { TimelineSample } from '../core/RoundTimeline';
import type { Aircraft } from '../objects/Aircraft';
import type { CrashEffect } from '../objects/CrashEffect';
import type { CrashGraph } from '../objects/CrashGraph';
import type { MultiplierDisplay } from '../objects/MultiplierDisplay';

/** Long-lived objects shared by every scene (scenes configure, never own, them). */
export interface SceneWorld {
  graph: CrashGraph;
  aircraft: Aircraft;
  multiplier: MultiplierDisplay;
  effect: CrashEffect;
  graphAnimator: GraphAnimator;
  aircraftAnimator: AircraftAnimator;
  readonly layout: Layout;
}

export interface FrameInfo {
  dtMs: number;
  /** Skip smoothing this frame (after resync, resize or returning from a hidden tab). */
  snap: boolean;
}

export type SceneKey = 'betting' | 'running' | 'crashed';

/**
 * A scene reacts to the sampled round state; it never changes game state itself.
 * `root` holds scene-specific overlay nodes; shared objects live in SceneWorld.
 */
export abstract class BaseScene {
  readonly root = new Container();

  constructor(protected readonly world: SceneWorld) {
    this.root.visible = false;
  }

  enter(_sample: TimelineSample, _previous: SceneKey | null): void {}

  exit(): void {}

  abstract update(sample: TimelineSample, frame: FrameInfo): void;

  resize(_layout: Layout): void {}

  destroy(): void {
    this.root.destroy({ children: true });
  }

  protected applyAircraftPose(): void {
    const { aircraft, aircraftAnimator, layout } = this.world;
    aircraft.position.set(aircraftAnimator.x, aircraftAnimator.y);
    aircraft.rotation = aircraftAnimator.rotation;
    aircraft.scale.set(layout.aircraftScale);
  }
}

import { gameConfig } from '../../config/gameConfig';
import { RoundState } from '../../types/game';
import type { TimelineSample } from '../core/RoundTimeline';
import { theme } from '../theme';
import { BaseScene, type FrameInfo, type SceneKey } from './BaseScene';

const FLY_OFF_MS = 450;

/** Frozen red curve, explosion (only for a live crash) and the final multiplier. */
export class CrashedScene extends BaseScene {
  private flyOff = 0;

  override enter(sample: TimelineSample, previous: SceneKey | null): void {
    const { graph, graphAnimator, effect, aircraft, layout } = this.world;
    graph.setMode('crashed');
    // Entering without a flight (e.g. restored from a snapshot) needs the range set directly.
    if (previous !== 'running') {
      graphAnimator.update(0, sample.elapsedMs, sample.multiplier, true);
    }
    graph.draw(graphAnimator.range, sample.elapsedMs, sample.growthRate);

    const liveCrash =
      previous === 'running' && sample.msSinceCrash < gameConfig.animation.crashEffectMaxAgeMs;
    if (liveCrash) {
      effect.trigger(aircraft.x, aircraft.y, layout.aircraftScale);
      this.flyOff = FLY_OFF_MS;
      aircraft.setThrust(0);
    } else {
      effect.reset();
      aircraft.visible = false;
      this.flyOff = 0;
    }
  }

  override exit(): void {
    this.world.effect.reset();
  }

  update(sample: TimelineSample, frame: FrameInfo): void {
    const { graph, graphAnimator, aircraft, effect, multiplier } = this.world;
    graph.draw(graphAnimator.range, sample.elapsedMs, sample.growthRate);
    effect.update(frame.dtMs);

    if (this.flyOff > 0) {
      this.flyOff = Math.max(0, this.flyOff - frame.dtMs);
      const t = 1 - this.flyOff / FLY_OFF_MS;
      aircraft.alpha = 1 - t;
      aircraft.scale.set(this.world.layout.aircraftScale * (1 - t * 0.6));
      aircraft.rotation += (frame.dtMs / 1000) * 6;
      aircraft.update(frame.dtMs);
      if (this.flyOff === 0) aircraft.visible = false;
    }

    if (sample.crashMultiplier !== null) multiplier.showCrashed(sample.crashMultiplier);
    if (sample.phase === RoundState.IDLE && sample.crashMultiplier !== null) {
      multiplier.showMessage(
        `${sample.crashMultiplier.toFixed(2)}x`,
        'NEXT ROUND SOON',
        theme.crashed,
      );
    }
  }
}

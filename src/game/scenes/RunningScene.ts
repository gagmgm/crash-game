import type { TimelineSample } from '../core/RoundTimeline';
import { BaseScene, type FrameInfo, type SceneKey } from './BaseScene';

/** The flight: curve grows, axes rescale, aircraft follows the tip. */
export class RunningScene extends BaseScene {
  private firstFrame = true;

  override enter(_sample: TimelineSample, _previous: SceneKey | null): void {
    const { graph, effect, aircraft } = this.world;
    graph.setMode('running');
    effect.reset();
    aircraft.visible = true;
    aircraft.alpha = 1;
    aircraft.setThrust(1);
    this.firstFrame = true;
  }

  update(sample: TimelineSample, frame: FrameInfo): void {
    const { graph, graphAnimator, aircraft, aircraftAnimator, multiplier, layout } = this.world;
    const snap = frame.snap || this.firstFrame;
    this.firstFrame = false;

    const range = graphAnimator.update(frame.dtMs, sample.elapsedMs, sample.multiplier, snap);
    graph.draw(range, sample.elapsedMs, sample.growthRate);

    const tip = graph.tipPoint;
    const prev = graph.trailingPoint;
    aircraftAnimator.follow(frame.dtMs, tip.x, tip.y, prev.x, prev.y, layout.graphRect, snap);
    this.applyAircraftPose();
    aircraft.update(frame.dtMs);

    multiplier.showMultiplier(sample.multiplier, sample.stalled);
  }
}

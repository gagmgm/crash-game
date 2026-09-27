import { gameConfig } from '../../config/gameConfig';
import { clamp, dampAngle } from '../../utils/math';
import type { Rect } from '../core/layout';

type AnimationOptions = typeof gameConfig.animation;

/**
 * Computes the aircraft pose from the curve tip. Position follows the tip exactly (so it
 * stays glued to the graph when the axes rescale); only the heading is smoothed.
 */
export class AircraftAnimator {
  x = 0;
  y = 0;
  rotation = 0;
  private time = 0;

  constructor(private readonly options: AnimationOptions = gameConfig.animation) {}

  reset(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.rotation = -0.25;
    this.time = 0;
  }

  follow(
    dtMs: number,
    tipX: number,
    tipY: number,
    prevX: number,
    prevY: number,
    bounds: Rect,
    snap: boolean,
  ): void {
    this.time += dtMs;
    const heading = Math.atan2(tipY - prevY, Math.max(1e-3, tipX - prevX));
    const target = clamp(heading, -Math.PI / 2.4, 0.1);
    this.rotation = snap
      ? target
      : dampAngle(this.rotation, target, this.options.aircraftRotationSmoothing, dtMs);
    const bob = Math.sin(this.time / 180) * 1.5;
    this.x = clamp(tipX, bounds.x, bounds.x + bounds.width);
    this.y = clamp(tipY + bob, bounds.y, bounds.y + bounds.height);
  }

  /** Gentle hover used while parked during betting. */
  idle(dtMs: number, x: number, y: number): void {
    this.time += dtMs;
    this.x = x;
    this.y = y + Math.sin(this.time / 400) * 3;
    this.rotation = -0.25 + Math.sin(this.time / 900) * 0.04;
  }
}

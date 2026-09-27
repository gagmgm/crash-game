import { gameConfig } from '../../config/gameConfig';
import { damp } from '../../utils/math';
import type { Rect } from '../core/layout';

export interface GraphRange {
  maxTimeMs: number;
  maxMultiplier: number;
}

type GraphOptions = typeof gameConfig.graph;

/**
 * Animates the visible axis range as the round grows (1x-2x -> 1x-5x -> ... -> 100x+)
 * with frame-rate independent smoothing, while guaranteeing the curve tip stays visible.
 */
export class GraphAnimator {
  readonly range: GraphRange;
  private readonly target: GraphRange;

  constructor(private readonly options: GraphOptions = gameConfig.graph) {
    this.range = this.minimumRange();
    this.target = this.minimumRange();
  }

  reset(): void {
    Object.assign(this.range, this.minimumRange());
  }

  update(dtMs: number, elapsedMs: number, multiplier: number, snap: boolean): GraphRange {
    const o = this.options;
    this.target.maxTimeMs = Math.max(o.minVisibleTimeMs, elapsedMs * o.headroomTime);
    this.target.maxMultiplier = Math.max(
      o.minVisibleMultiplier,
      1 + (multiplier - 1) * o.headroomMultiplier,
    );
    if (snap) {
      Object.assign(this.range, this.target);
      return this.range;
    }
    // The range only grows within a round; the damped value is kept at least large
    // enough that the tip is on-screen.
    const needTime = elapsedMs * 1.02;
    const needMult = 1 + (multiplier - 1) * 1.02;
    this.range.maxTimeMs = Math.max(
      this.range.maxTimeMs,
      needTime,
      damp(this.range.maxTimeMs, this.target.maxTimeMs, o.rangeSmoothing, dtMs),
    );
    this.range.maxMultiplier = Math.max(
      this.range.maxMultiplier,
      needMult,
      damp(this.range.maxMultiplier, this.target.maxMultiplier, o.rangeSmoothing, dtMs),
    );
    return this.range;
  }

  private minimumRange(): GraphRange {
    return {
      maxTimeMs: this.options.minVisibleTimeMs,
      maxMultiplier: this.options.minVisibleMultiplier,
    };
  }
}

/** Logical (time, multiplier) -> screen coordinates. */
export function projectX(timeMs: number, range: GraphRange, rect: Rect): number {
  return rect.x + (timeMs / range.maxTimeMs) * rect.width;
}

export function projectY(multiplier: number, range: GraphRange, rect: Rect): number {
  const t = (multiplier - 1) / Math.max(1e-6, range.maxMultiplier - 1);
  return rect.y + rect.height - t * rect.height;
}

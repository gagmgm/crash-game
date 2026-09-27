import { BitmapText, Container, Graphics } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { multiplierAt, niceStep } from '../../utils/math';
import { projectX, projectY, type GraphRange } from '../animation/GraphAnimator';
import type { Layout, Rect } from '../core/layout';
import { theme } from '../theme';

export type GraphMode = 'idle' | 'running' | 'crashed';

type GraphOptions = typeof gameConfig.graph;

const MAX_LABELS = 12;

function createLabel(size: number): BitmapText {
  const label = new BitmapText({
    text: '',
    style: { fontFamily: theme.fontFamily, fontSize: size, fill: theme.label },
  });
  label.visible = false;
  return label;
}

/**
 * Axes, grid, labels and the multiplier curve. Pure presentation: it is given a range
 * and the visible (time, multiplier) tip and draws them. Graphics/labels are created once
 * and reused; nothing is allocated per frame.
 */
export class CrashGraph extends Container {
  private readonly grid = new Graphics();
  private readonly fill = new Graphics();
  private readonly curve = new Graphics();
  private readonly markerLayer = new Graphics();
  private readonly yLabels: BitmapText[] = [];
  private readonly xLabels: BitmapText[] = [];
  private readonly markerLabel: BitmapText;
  private rect: Rect = { x: 0, y: 0, width: 1, height: 1 };
  private mode: GraphMode = 'idle';
  private marker: { timeMs: number; multiplier: number } | null = null;
  // Last-drawn inputs, compared numerically to skip redundant redraws without allocating.
  private gridDirty = true;
  private curveDirty = true;
  private lastRangeTime = -1;
  private lastRangeMult = -1;
  private lastElapsed = -1;
  private readonly tip = { x: 0, y: 0 };
  private readonly prev = { x: 0, y: 0 };

  constructor(private readonly options: GraphOptions = gameConfig.graph) {
    super();
    this.addChild(this.grid, this.fill, this.curve, this.markerLayer);
    for (let i = 0; i < MAX_LABELS; i += 1) {
      const y = createLabel(12);
      const x = createLabel(12);
      this.yLabels.push(y);
      this.xLabels.push(x);
      this.addChild(y, x);
    }
    this.markerLabel = new BitmapText({
      text: '',
      style: { fontFamily: theme.fontFamily, fontSize: 14, fill: 0xffffff, fontWeight: 'bold' },
    });
    this.markerLabel.tint = theme.success;
    this.markerLabel.anchor.set(0.5, 1);
    this.markerLabel.visible = false;
    this.addChild(this.markerLabel);
  }

  resize(layout: Layout): void {
    this.rect = { ...layout.graphRect };
    const scale = layout.labelFontSize / 12;
    for (const label of [...this.yLabels, ...this.xLabels]) label.scale.set(scale);
    this.gridDirty = true;
    this.curveDirty = true;
  }

  setMode(mode: GraphMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.curveDirty = true;
  }

  setMarker(timeMs: number, multiplier: number): void {
    this.marker = { timeMs, multiplier };
    this.markerLabel.text = `${multiplier.toFixed(2)}x`;
    this.curveDirty = true;
  }

  clearMarker(): void {
    this.marker = null;
    this.markerLabel.visible = false;
    this.markerLayer.clear();
  }

  /** Screen position of the curve tip after the last render. */
  get tipPoint(): Readonly<{ x: number; y: number }> {
    return this.tip;
  }

  /** A point slightly behind the tip, used for the aircraft heading. */
  get trailingPoint(): Readonly<{ x: number; y: number }> {
    return this.prev;
  }

  draw(range: GraphRange, elapsedMs: number, growthRate: number): void {
    if (range.maxTimeMs !== this.lastRangeTime || range.maxMultiplier !== this.lastRangeMult) {
      this.lastRangeTime = range.maxTimeMs;
      this.lastRangeMult = range.maxMultiplier;
      this.gridDirty = true;
    }
    if (this.gridDirty) {
      this.gridDirty = false;
      this.curveDirty = true;
      this.drawGrid(range);
    }
    if (this.curveDirty || elapsedMs !== this.lastElapsed) {
      this.curveDirty = false;
      this.lastElapsed = elapsedMs;
      this.drawCurve(range, elapsedMs, growthRate);
    }
  }

  private drawGrid(range: GraphRange): void {
    const r = this.rect;
    const g = this.grid.clear();
    const yStep = niceStep(range.maxMultiplier - 1, this.options.maxYTicks);
    let yi = 0;
    // Baseline at 1x, then clean multiples of the step (1.2, 1.4… or 10, 20…), never 11x/21x.
    const firstMultiple = (Math.floor(1 / yStep + 1e-9) + 1) * yStep;
    for (
      let v = 1;
      v <= range.maxMultiplier + 1e-9 && yi < MAX_LABELS;
      v = v === 1 ? firstMultiple : v + yStep
    ) {
      const y = projectY(v, range, r);
      g.moveTo(r.x, y).lineTo(r.x + r.width, y);
      const label = this.yLabels[yi++] as BitmapText;
      label.visible = true;
      label.text = `${yStep < 1 ? v.toFixed(1) : Math.round(v)}x`;
      label.anchor.set(1, 0.5);
      label.position.set(r.x - 8, y);
    }
    for (; yi < MAX_LABELS; yi += 1) (this.yLabels[yi] as BitmapText).visible = false;

    const xStepMs = niceStep(range.maxTimeMs / 1000, this.options.maxXTicks) * 1000;
    let xi = 0;
    for (let t = 0; t <= range.maxTimeMs + 1e-6 && xi < MAX_LABELS; t += xStepMs) {
      const x = projectX(t, range, r);
      g.moveTo(x, r.y).lineTo(x, r.y + r.height);
      const label = this.xLabels[xi++] as BitmapText;
      label.visible = true;
      label.text = `${Math.round(t / 1000)}s`;
      label.anchor.set(0.5, 0);
      label.position.set(x, r.y + r.height + 8);
    }
    for (; xi < MAX_LABELS; xi += 1) (this.xLabels[xi] as BitmapText).visible = false;
    g.stroke({ width: 1, color: theme.grid, alpha: 0.9 });

    g.moveTo(r.x, r.y)
      .lineTo(r.x, r.y + r.height)
      .lineTo(r.x + r.width, r.y + r.height)
      .stroke({ width: 2, color: theme.axis });
  }

  private drawCurve(range: GraphRange, elapsedMs: number, growthRate: number): void {
    const r = this.rect;
    const originX = projectX(0, range, r);
    const originY = projectY(1, range, r);
    const curve = this.curve.clear();
    const fill = this.fill.clear();
    this.tip.x = originX;
    this.tip.y = originY;
    this.prev.x = originX - 1;
    this.prev.y = originY;

    if (this.mode === 'idle' || elapsedMs <= 0) {
      this.markerLayer.clear();
      this.markerLabel.visible = false;
      return;
    }

    const color = this.mode === 'crashed' ? theme.crashed : theme.curve;
    const segments = this.options.curveSegments;
    const lookback = Math.max(0, elapsedMs - gameConfig.animation.aircraftTangentLookbackMs);

    curve.moveTo(originX, originY);
    fill.moveTo(originX, originY);
    for (let i = 1; i <= segments; i += 1) {
      const t = (elapsedMs * i) / segments;
      const x = projectX(t, range, r);
      const y = projectY(multiplierAt(t, growthRate), range, r);
      curve.lineTo(x, y);
      fill.lineTo(x, y);
    }
    this.tip.x = projectX(elapsedMs, range, r);
    this.tip.y = projectY(multiplierAt(elapsedMs, growthRate), range, r);
    this.prev.x = projectX(lookback, range, r);
    this.prev.y = projectY(multiplierAt(lookback, growthRate), range, r);

    curve.stroke({ width: this.options.lineWidth, color, cap: 'round', join: 'round' });
    fill
      .lineTo(this.tip.x, originY)
      .closePath()
      .fill({ color: this.mode === 'crashed' ? theme.crashed : theme.curveFill, alpha: 0.12 });

    this.drawMarker(range, elapsedMs);
  }

  private drawMarker(range: GraphRange, elapsedMs: number): void {
    const m = this.markerLayer.clear();
    if (!this.marker || this.marker.timeMs > elapsedMs + 1) {
      this.markerLabel.visible = false;
      return;
    }
    const x = projectX(this.marker.timeMs, range, this.rect);
    const y = projectY(this.marker.multiplier, range, this.rect);
    m.circle(x, y, 6).fill({ color: theme.success }).circle(x, y, 11).stroke({
      width: 2,
      color: theme.success,
      alpha: 0.5,
    });
    this.markerLabel.visible = true;
    this.markerLabel.position.set(x, y - 14);
  }
}

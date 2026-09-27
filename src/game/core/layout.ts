import type { Viewport } from './ViewportManager';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  viewport: Viewport;
  /** Plot area of the graph (axes origin at bottom-left). */
  graphRect: Rect;
  multiplierX: number;
  multiplierY: number;
  multiplierFontSize: number;
  labelFontSize: number;
  aircraftScale: number;
}

/** Pure layout computation from a normalized viewport; no DOM access. */
export function computeLayout(viewport: Viewport): Layout {
  const { width, height, compact } = viewport;
  const padLeft = compact ? 40 : 56;
  const padRight = compact ? 20 : 32;
  const padTop = compact ? 16 : 28;
  const padBottom = compact ? 28 : 36;
  const graphRect: Rect = {
    x: padLeft,
    y: padTop,
    width: Math.max(10, width - padLeft - padRight),
    height: Math.max(10, height - padTop - padBottom),
  };
  const minSide = Math.min(width, height);
  return {
    viewport,
    graphRect,
    multiplierX: graphRect.x + graphRect.width / 2,
    multiplierY:
      graphRect.y + graphRect.height * (viewport.orientation === 'portrait' ? 0.3 : 0.36),
    multiplierFontSize: Math.round(Math.min(120, Math.max(40, minSide * 0.17))),
    labelFontSize: compact ? 10 : 12,
    aircraftScale: Math.min(1.2, Math.max(0.55, minSide / 520)),
  };
}

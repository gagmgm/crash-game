export interface Viewport {
  width: number;
  height: number;
  dpr: number;
  orientation: 'landscape' | 'portrait';
  /** Small screens get tighter layout and smaller type. */
  compact: boolean;
}

const COMPACT_WIDTH = 640;

export function createViewport(width: number, height: number, dpr: number): Viewport {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  return {
    width: w,
    height: h,
    dpr,
    orientation: w >= h ? 'landscape' : 'portrait',
    compact: w < COMPACT_WIDTH || h < 360,
  };
}

/**
 * The only place that measures the canvas host. Observes the host element (covers window
 * resize, orientation change, flex/iframe resizes) and devicePixelRatio changes (browser
 * zoom, moving between monitors), and emits a normalized Viewport, coalesced per frame.
 */
export class ViewportManager {
  private observer: ResizeObserver | null = null;
  private dprQuery: MediaQueryList | null = null;
  private frame: number | null = null;
  private current: Viewport;

  constructor(
    private readonly host: HTMLElement,
    private readonly onChange: (viewport: Viewport) => void,
    private readonly maxDpr: number,
  ) {
    this.current = this.measure();
  }

  get viewport(): Viewport {
    return this.current;
  }

  start(): void {
    this.current = this.measure();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.schedule);
      this.observer.observe(this.host);
    } else {
      window.addEventListener('resize', this.schedule);
    }
    this.watchDpr();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    window.removeEventListener('resize', this.schedule);
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private readonly schedule = (): void => {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.update();
    });
  };

  private readonly onDprChange = (): void => {
    this.watchDpr();
    this.schedule();
  };

  /** A resolution media query only fires once, so re-arm it for the new DPR each time. */
  private watchDpr(): void {
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    if (typeof window.matchMedia !== 'function') return;
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.dprQuery.addEventListener('change', this.onDprChange);
  }

  private update(): void {
    const next = this.measure();
    const prev = this.current;
    if (next.width === prev.width && next.height === prev.height && next.dpr === prev.dpr) return;
    this.current = next;
    this.onChange(next);
  }

  private measure(): Viewport {
    const rect = this.host.getBoundingClientRect();
    const dpr = Math.min(this.maxDpr, Math.max(1, window.devicePixelRatio || 1));
    return createViewport(rect.width, rect.height, dpr);
  }
}

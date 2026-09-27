import { Application, Container, type Ticker } from 'pixi.js';
import { gameConfig, type GameConfig } from '../config/gameConfig';
import { RoundState } from '../types/game';
import type { Unsubscribe } from '../types/network';
import { elapsedForMultiplier } from '../utils/math';
import { createLogger } from '../utils/logger';
import { onPageVisibility } from '../utils/visibility';
import { AircraftAnimator } from './animation/AircraftAnimator';
import { GraphAnimator } from './animation/GraphAnimator';
import type { EventBus } from './core/EventBus';
import { computeLayout, type Layout } from './core/layout';
import {
  createTimelineSample,
  type RoundTimelineReader,
  type TimelineSample,
} from './core/RoundTimeline';
import { SceneManager } from './core/SceneManager';
import { ViewportManager, createViewport, type Viewport } from './core/ViewportManager';
import type { GameEvents } from './gameEvents';
import { Aircraft } from './objects/Aircraft';
import { Background } from './objects/Background';
import { CrashEffect } from './objects/CrashEffect';
import { CrashGraph } from './objects/CrashGraph';
import { MultiplierDisplay } from './objects/MultiplierDisplay';
import type { FrameInfo, SceneWorld } from './scenes/BaseScene';
import { BettingScene } from './scenes/BettingScene';
import { CrashedScene } from './scenes/CrashedScene';
import { RunningScene } from './scenes/RunningScene';

export interface CrashGameDeps {
  timeline: RoundTimelineReader;
  clock: { serverNow(): number };
  events: EventBus<GameEvents>;
  config?: GameConfig;
}

type Lifecycle = 'created' | 'initializing' | 'ready' | 'running' | 'paused' | 'destroyed';

const logger = createLogger('pixi');

/**
 * Owns the PixiJS Application: canvas mounting, ticker, resize, scenes and cleanup.
 * It *reads* round state (RoundTimeline) every frame and renders it; it never writes state.
 */
export class CrashGame {
  private state: Lifecycle = 'created';
  private app: Application | null = null;
  private viewportManager: ViewportManager | null = null;
  private scenes: SceneManager | null = null;
  private background: Background | null = null;
  private world: (SceneWorld & { layout: Layout }) | null = null;
  private readonly sample: TimelineSample = createTimelineSample();
  private readonly frame: FrameInfo = { dtMs: 0, snap: true };
  private readonly subscriptions: Unsubscribe[] = [];
  private snapNextFrame = true;
  private readonly config: GameConfig;

  constructor(private readonly deps: CrashGameDeps) {
    this.config = deps.config ?? gameConfig;
  }

  get lifecycle(): Lifecycle {
    return this.state;
  }

  async init(host: HTMLElement): Promise<void> {
    if (this.state !== 'created') throw new Error(`CrashGame.init called in state ${this.state}`);
    this.state = 'initializing';

    const viewportManager = new ViewportManager(
      host,
      (vp) => this.applyViewport(vp),
      this.config.render.maxDevicePixelRatio,
    );
    const vp = viewportManager.viewport;
    const app = new Application();
    try {
      await app.init({
        width: vp.width,
        height: vp.height,
        resolution: vp.dpr,
        autoDensity: true,
        antialias: true,
        background: this.config.render.backgroundColor,
        autoStart: false,
        sharedTicker: false,
        preference: 'webgl',
      });
    } catch (error) {
      this.state = 'destroyed';
      throw error;
    }

    // destroy() may have been called while awaiting (e.g. React StrictMode unmount).
    if ((this.state as Lifecycle) === 'destroyed') {
      app.destroy({ removeView: true }, { children: true });
      return;
    }

    this.app = app;
    this.viewportManager = viewportManager;
    app.canvas.style.display = 'block';
    app.canvas.style.width = '100%';
    app.canvas.style.height = '100%';
    app.canvas.setAttribute('aria-label', 'Crash game graph');
    host.appendChild(app.canvas);

    this.buildWorld(app, computeLayout(vp));
    app.ticker.add(this.onTick, this);
    viewportManager.start();

    this.subscriptions.push(
      onPageVisibility((visible) => (visible ? this.resume() : this.pause())),
      this.deps.events.on('resynced', () => {
        this.snapNextFrame = true;
      }),
      this.deps.events.on('cashoutConfirmed', ({ roundId, multiplier }) => {
        if (roundId !== this.sample.roundId || !this.world) return;
        this.world.graph.setMarker(
          elapsedForMultiplier(multiplier, this.sample.growthRate),
          multiplier,
        );
      }),
    );
    this.state = 'ready';
  }

  start(): void {
    if (this.state !== 'ready' && this.state !== 'paused') return;
    this.state = 'running';
    this.snapNextFrame = true;
    this.app?.ticker.start();
  }

  pause(): void {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.app?.ticker.stop();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    // Everything is derived from timeline + clock, so the next frame is correct as-is;
    // snapping just skips smoothing over the gap.
    this.start();
  }

  resize(width: number, height: number): void {
    const dpr = this.viewportManager?.viewport.dpr ?? 1;
    this.applyViewport(createViewport(width, height, dpr));
  }

  destroy(): void {
    if (this.state === 'destroyed') return;
    const wasInitializing = this.state === 'initializing';
    this.state = 'destroyed';
    this.subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
    if (wasInitializing) return; // init() finishes the teardown once Pixi is ready.

    this.viewportManager?.stop();
    this.viewportManager = null;
    const app = this.app;
    this.app = null;
    if (app) {
      app.ticker.remove(this.onTick, this);
      app.ticker.stop();
    }
    this.scenes?.destroy();
    this.scenes = null;
    this.world = null;
    this.background = null;
    try {
      app?.destroy({ removeView: true }, { children: true });
    } catch (error) {
      logger.warn('error while destroying Pixi application', error);
    }
  }

  private buildWorld(app: Application, layout: Layout): void {
    const background = new Background();
    const graph = new CrashGraph(this.config.graph);
    const aircraft = new Aircraft();
    const effect = new CrashEffect();
    const multiplier = new MultiplierDisplay();
    const overlays = new Container();
    app.stage.addChild(background, graph, aircraft, effect, multiplier, overlays);

    this.world = {
      graph,
      aircraft,
      effect,
      multiplier,
      graphAnimator: new GraphAnimator(this.config.graph),
      aircraftAnimator: new AircraftAnimator(this.config.animation),
      layout,
    };
    this.background = background;
    this.scenes = new SceneManager(overlays);
    this.scenes.register('betting', new BettingScene(this.world));
    this.scenes.register('running', new RunningScene(this.world));
    this.scenes.register('crashed', new CrashedScene(this.world));
    this.layoutWorld(layout);
  }

  private applyViewport(vp: Viewport): void {
    if (!this.app) return;
    this.app.renderer.resize(vp.width, vp.height, vp.dpr);
    this.layoutWorld(computeLayout(vp));
    this.snapNextFrame = true;
  }

  private layoutWorld(layout: Layout): void {
    if (!this.world) return;
    this.world.layout = layout;
    this.background?.resize(layout);
    this.world.graph.resize(layout);
    this.world.multiplier.resize(layout);
    this.scenes?.resize(layout);
  }

  private onTick(ticker: Ticker): void {
    if (!this.world || !this.scenes) return;
    this.frame.dtMs = Math.min(ticker.deltaMS, this.config.animation.maxFrameDtMs);
    this.frame.snap = this.snapNextFrame;
    this.snapNextFrame = false;

    const sample = this.deps.timeline.sample(this.deps.clock.serverNow(), this.sample);
    this.scenes.sync(sample);
    this.scenes.update(sample, this.frame);

    const speed =
      sample.phase === RoundState.RUNNING ? 60 + Math.min(240, (sample.multiplier - 1) * 40) : 12;
    this.background?.update(this.frame.dtMs, speed);
  }
}

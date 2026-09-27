import { Sprite, Texture } from 'pixi.js';
import { RoundState } from '../../types/game';
import type { Layout } from '../core/layout';
import type { TimelineSample } from '../core/RoundTimeline';
import { theme } from '../theme';
import { BaseScene, type FrameInfo } from './BaseScene';

/** Lobby: IDLE (no round yet), BETTING countdown and STARTING. */
export class BettingScene extends BaseScene {
  // Texture.WHITE is shared: sprites are scaled, never redrawn, and the texture is never destroyed.
  private readonly track = new Sprite(Texture.WHITE);
  private readonly bar = new Sprite(Texture.WHITE);
  private barWidth = 200;
  private readonly spot = { x: 0, y: 0 };

  constructor(...args: ConstructorParameters<typeof BaseScene>) {
    super(...args);
    this.track.tint = theme.grid;
    this.bar.tint = theme.curve;
    this.root.addChild(this.track, this.bar);
  }

  override enter(): void {
    const { graph, graphAnimator, effect, aircraft, aircraftAnimator } = this.world;
    graphAnimator.reset();
    graph.setMode('idle');
    graph.clearMarker();
    effect.reset();
    aircraft.visible = true;
    aircraft.alpha = 1;
    const origin = this.parkingSpot();
    aircraftAnimator.reset(origin.x, origin.y);
    this.resize(this.world.layout);
  }

  override resize(layout: Layout): void {
    this.barWidth = Math.min(320, layout.graphRect.width * 0.5);
    const y = layout.multiplierY + layout.multiplierFontSize * 0.95;
    this.track.position.set(layout.multiplierX - this.barWidth / 2, y);
    this.track.width = this.barWidth;
    this.track.height = 6;
    this.bar.position.set(layout.multiplierX - this.barWidth / 2, y);
    this.bar.height = 6;
  }

  update(sample: TimelineSample, frame: FrameInfo): void {
    const { graph, graphAnimator, aircraft, aircraftAnimator, multiplier } = this.world;
    graph.draw(graphAnimator.range, 0, sample.growthRate);

    const spot = this.parkingSpot();
    aircraftAnimator.idle(frame.dtMs, spot.x, spot.y);
    this.applyAircraftPose();
    aircraft.update(frame.dtMs);

    const showBar = sample.phase === RoundState.BETTING && sample.countdownTotalMs > 0;
    this.track.visible = showBar;
    this.bar.visible = showBar;
    if (showBar) {
      this.bar.width = this.barWidth * Math.min(1, sample.countdownMs / sample.countdownTotalMs);
    }

    switch (sample.phase) {
      case RoundState.BETTING:
        aircraft.setThrust(0.15);
        multiplier.showCountdown('PLACE YOUR BETS', sample.countdownMs);
        break;
      case RoundState.STARTING:
        aircraft.setThrust(0.6);
        multiplier.showMessage('1.00x', 'LAUNCHING…', theme.warning);
        break;
      default:
        aircraft.setThrust(0.1);
        multiplier.showMessage('—', 'WAITING FOR NEXT ROUND', theme.mutedText);
    }
  }

  private parkingSpot(): Readonly<{ x: number; y: number }> {
    const { graphRect, aircraftScale } = this.world.layout;
    this.spot.x = graphRect.x + 34 * aircraftScale;
    this.spot.y = graphRect.y + graphRect.height - 26 * aircraftScale;
    return this.spot;
  }
}

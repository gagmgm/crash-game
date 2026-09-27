import { Container, Graphics } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import type { Layout } from '../core/layout';
import { theme } from '../theme';

interface Star {
  node: Graphics;
  depth: number;
}

/** Decorative only: reads the round phase to vary speed but never influences game state. */
export class Background extends Container {
  private readonly base = new Graphics();
  private readonly glow = new Graphics();
  private readonly starLayer = new Container();
  private readonly stars: Star[] = [];
  private viewWidth = 1;
  private viewHeight = 1;
  private speed = 0;

  constructor(private readonly random: () => number = Math.random) {
    super();
    this.addChild(this.base, this.glow, this.starLayer);
    for (let i = 0; i < gameConfig.animation.backgroundStarCount; i += 1) {
      const depth = 0.2 + this.random() * 0.8;
      const node = new Graphics().circle(0, 0, 0.6 + depth * 1.2).fill({ color: theme.star });
      node.alpha = 0.15 + depth * 0.5;
      this.starLayer.addChild(node);
      this.stars.push({ node, depth });
    }
  }

  resize(layout: Layout): void {
    this.viewWidth = layout.viewport.width;
    this.viewHeight = layout.viewport.height;
    this.base.clear().rect(0, 0, this.viewWidth, this.viewHeight).fill({ color: theme.background });
    const r = Math.max(this.viewWidth, this.viewHeight);
    this.glow
      .clear()
      .circle(this.viewWidth * 0.8, this.viewHeight * 0.1, r * 0.45)
      .fill({ color: theme.backgroundGlow, alpha: 0.18 })
      .circle(this.viewWidth * 0.1, this.viewHeight * 0.95, r * 0.35)
      .fill({ color: 0x3b1d5a, alpha: 0.12 });
    for (const star of this.stars) {
      star.node.position.set(this.random() * this.viewWidth, this.random() * this.viewHeight);
    }
  }

  /** `targetSpeed` is px/second of the nearest star layer. */
  update(dtMs: number, targetSpeed: number): void {
    const dt = dtMs / 1000;
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 2);
    for (const star of this.stars) {
      const p = star.node.position;
      p.x -= this.speed * star.depth * dt;
      p.y += this.speed * star.depth * dt * 0.35;
      if (p.x < -4) p.x += this.viewWidth + 8;
      if (p.y > this.viewHeight + 4) p.y -= this.viewHeight + 8;
    }
  }
}

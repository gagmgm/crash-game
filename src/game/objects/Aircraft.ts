import { Container, Graphics } from 'pixi.js';

/**
 * Placeholder rocket built from primitives (no art assets). Drawn once, pointing +X;
 * only transforms change per frame. Replace the drawing code with sprites later.
 */
export class Aircraft extends Container {
  private readonly body = new Graphics();
  private readonly flame = new Graphics();
  private time = 0;
  private thrust = 1;

  constructor() {
    super();
    this.flame
      .poly([-24, -6, -50, 0, -24, 6])
      .fill({ color: 0xf97316 })
      .poly([-24, -3.5, -38, 0, -24, 3.5])
      .fill({ color: 0xfde047 });
    this.body
      .poly([-18, -9, -30, -21, -10, -9])
      .fill({ color: 0x6366f1 })
      .poly([-18, 9, -30, 21, -10, 9])
      .fill({ color: 0x6366f1 })
      .roundRect(-26, -9, 44, 18, 8)
      .fill({ color: 0xe2e8f0 })
      .poly([16, -9, 36, 0, 16, 9])
      .fill({ color: 0xef4444 })
      .circle(4, 0, 4.5)
      .fill({ color: 0x0ea5e9 })
      .circle(4, 0, 4.5)
      .stroke({ width: 1.5, color: 0x334155 });
    this.addChild(this.flame, this.body);
  }

  /** 0 = parked, 1 = full thrust. */
  setThrust(thrust: number): void {
    this.thrust = thrust;
  }

  update(dtMs: number): void {
    this.time += dtMs;
    const flicker = 0.85 + Math.sin(this.time / 35) * 0.1 + Math.sin(this.time / 13) * 0.05;
    this.flame.scale.set(Math.max(0.05, this.thrust * flicker), 0.9 + (flicker - 0.85) * 0.6);
    this.flame.alpha = Math.min(1, 0.2 + this.thrust);
  }
}

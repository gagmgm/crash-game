import { Container, Graphics } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';

interface Particle {
  node: Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

const COLORS = [0xef4444, 0xf97316, 0xfde047, 0xffffff, 0xf87171];

/**
 * Explosion placeholder: flash + shockwave + pooled particles. The pool is allocated once;
 * trigger() recycles it, so repeated crashes allocate nothing.
 */
export class CrashEffect extends Container {
  private readonly flash = new Graphics().circle(0, 0, 30).fill({ color: 0xffffff });
  private readonly ring = new Graphics().circle(0, 0, 20).stroke({ width: 3, color: 0xf97316 });
  private readonly particles: Particle[] = [];
  private elapsed = 0;
  private active = false;

  constructor(private readonly random: () => number = Math.random) {
    super();
    this.addChild(this.ring, this.flash);
    for (let i = 0; i < gameConfig.animation.crashParticleCount; i += 1) {
      const color = COLORS[i % COLORS.length] as number;
      const node = new Graphics().circle(0, 0, 1.5 + (i % 3)).fill({ color });
      node.visible = false;
      this.addChild(node);
      this.particles.push({ node, vx: 0, vy: 0, life: 0, maxLife: 1 });
    }
    this.reset();
  }

  get isActive(): boolean {
    return this.active;
  }

  trigger(x: number, y: number, scale = 1): void {
    this.position.set(x, y);
    this.scale.set(scale);
    this.elapsed = 0;
    this.active = true;
    this.visible = true;
    for (const p of this.particles) {
      const angle = this.random() * Math.PI * 2;
      const speed = 80 + this.random() * 320;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - 40;
      p.maxLife = 500 + this.random() * 700;
      p.life = p.maxLife;
      p.node.position.set(0, 0);
      p.node.alpha = 1;
      p.node.visible = true;
    }
  }

  update(dtMs: number): void {
    if (!this.active) return;
    this.elapsed += dtMs;
    const dt = dtMs / 1000;
    const duration = gameConfig.animation.crashEffectDurationMs;
    const t = Math.min(1, this.elapsed / duration);

    this.flash.alpha = Math.max(0, 1 - this.elapsed / 180);
    this.flash.scale.set(1 + this.elapsed / 120);
    this.ring.alpha = Math.max(0, 1 - t * 1.4);
    this.ring.scale.set(1 + t * 5);

    const drag = Math.exp(-2.2 * dt);
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dtMs;
      p.vx *= drag;
      p.vy = p.vy * drag + 140 * dt;
      p.node.x += p.vx * dt;
      p.node.y += p.vy * dt;
      p.node.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) p.node.visible = false;
    }
    if (this.elapsed >= duration) this.reset();
  }

  reset(): void {
    this.active = false;
    this.visible = false;
    for (const p of this.particles) {
      p.life = 0;
      p.node.visible = false;
    }
  }
}

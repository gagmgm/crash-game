import { BitmapText, Container, Text } from 'pixi.js';
import type { Layout } from '../core/layout';
import { multiplierTint, theme } from '../theme';

const BASE_FONT_SIZE = 96;

/**
 * Large central readout. Text objects are created once; content is only re-set when the
 * displayed string actually changes (the bitmap font makes frequent updates cheap).
 */
export class MultiplierDisplay extends Container {
  private readonly value: BitmapText;
  private readonly caption: Text;
  private currentValue = '';
  private currentCaption = '';

  constructor() {
    super();
    this.value = new BitmapText({
      text: '1.00x',
      style: {
        fontFamily: theme.monoFontFamily,
        fontSize: BASE_FONT_SIZE,
        fill: 0xffffff,
        fontWeight: 'bold',
      },
    });
    this.value.anchor.set(0.5);
    this.caption = new Text({
      text: '',
      style: {
        fontFamily: theme.fontFamily,
        fontSize: 16,
        fill: theme.mutedText,
        fontWeight: '600',
        letterSpacing: 2,
      },
    });
    this.caption.anchor.set(0.5);
    this.addChild(this.value, this.caption);
  }

  resize(layout: Layout): void {
    this.position.set(layout.multiplierX, layout.multiplierY);
    const scale = layout.multiplierFontSize / BASE_FONT_SIZE;
    this.value.scale.set(scale);
    this.caption.style.fontSize = layout.viewport.compact ? 12 : 16;
    this.caption.position.set(0, layout.multiplierFontSize * 0.62);
  }

  showMultiplier(multiplier: number, stalled: boolean): void {
    this.setValue(`${(Math.floor(multiplier * 100 + 1e-9) / 100).toFixed(2)}x`);
    this.value.tint = multiplierTint(multiplier);
    this.value.alpha = stalled ? 0.6 : 1;
    this.setCaption(stalled ? 'WAITING FOR SERVER…' : '');
  }

  showCountdown(caption: string, countdownMs: number): void {
    this.setValue(`${(Math.max(0, countdownMs) / 1000).toFixed(1)}s`);
    this.value.tint = 0xffffff;
    this.value.alpha = 0.9;
    this.setCaption(caption);
  }

  showMessage(value: string, caption: string, tint: number = 0xffffff): void {
    this.setValue(value);
    this.value.tint = tint;
    this.value.alpha = 1;
    this.setCaption(caption);
  }

  showCrashed(crashMultiplier: number): void {
    this.setValue(`${crashMultiplier.toFixed(2)}x`);
    this.value.tint = theme.crashed;
    this.value.alpha = 1;
    this.setCaption('CRASHED');
  }

  private setValue(text: string): void {
    if (text === this.currentValue) return;
    this.currentValue = text;
    this.value.text = text;
  }

  private setCaption(text: string): void {
    if (text === this.currentCaption) return;
    this.currentCaption = text;
    this.caption.text = text;
    this.caption.visible = text.length > 0;
  }
}

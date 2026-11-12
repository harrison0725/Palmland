import { CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace } from '@iwsdk/core';

/** A camera-facing text bubble drawn on a canvas. Redraws only on change. */
export class Label {
  readonly sprite: Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly tex: CanvasTexture;
  private text = '';

  constructor(widthM = 0.14) {
    this.canvas.width = 1024;
    this.canvas.height = 256;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    const m = new SpriteMaterial({ map: this.tex, transparent: true, depthTest: false });
    this.sprite = new Sprite(m);
    this.sprite.scale.set(widthM, widthM / 4, 1);
    this.sprite.renderOrder = 10;
  }

  set(text: string): void {
    if (text === this.text) return;
    this.text = text;
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, 1024, 256);
    if (!text) {
      this.tex.needsUpdate = true;
      return;
    }
    c.font = '600 54px system-ui, sans-serif';
    const lines = wrap(c, text, 900);
    const h = lines.length * 66 + 50;
    const y0 = (256 - h) / 2;
    c.fillStyle = 'rgba(20,24,40,0.72)';
    roundRect(c, 20, y0, 984, h, 48);
    c.fill();
    c.fillStyle = '#fff8e8';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    lines.forEach((l, i) => c.fillText(l, 512, y0 + 25 + 33 + i * 66));
    this.tex.needsUpdate = true;
  }
}

function wrap(c: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (c.measureText(t).width > max && line) {
      out.push(line);
      line = w;
    } else line = t;
  }
  out.push(line);
  return out.slice(0, 3);
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

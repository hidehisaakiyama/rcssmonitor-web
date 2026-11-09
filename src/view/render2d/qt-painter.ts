// A small subset of QPainter on top of CanvasRenderingContext2D, so that the
// rcssmonitor painters can be ported call by call.
//
// - Coordinates are integers as in rcssmonitor. With antialiasing off
//   (rcssmonitor draws the field that way), odd-width lines are shifted by
//   half a pixel so that they cover whole pixels like Qt's aliased lines,
//   and thin ellipses and arcs are rasterized pixel by pixel, because a
//   canvas always antialiases curves.
// - Arc angles are in 1/16 degree, 0 at 3 o'clock, positive counter-clockwise
//   on the screen (Qt's convention).
// - Pen width 0 is Qt's cosmetic pen: 1 pixel.
import { DEG2RAD } from '../../core/geometry';
import { fontAscent, fontHeight } from '../font-metrics';

export interface Pen {
  readonly color: string;
  readonly width: number;
  /** Qt::DotLine */
  readonly dot?: boolean;
}

export class QtPainter {
  antialias = true;
  /** Drawing area in CSS pixels; pixels outside are not rasterized. */
  bounds = { width: 0, height: 0 };
  private pen: Pen | null = { color: '#000000', width: 0 };
  private brush: string | null = null;

  constructor(readonly ctx: CanvasRenderingContext2D) {}

  setPen(pen: Pen | string | null): void {
    this.pen = typeof pen === 'string' ? { color: pen, width: 0 } : pen;
  }

  setBrush(color: string | null): void {
    this.brush = color;
  }

  currentBrush(): string | null {
    return this.brush;
  }

  setFont(font: string): void {
    this.ctx.font = font;
  }

  /** QFontMetrics::ascent() of the current font. */
  fontAscent(): number {
    return fontAscent('', this.ctx);
  }

  /** QFontMetrics::height() of the current font. */
  fontHeight(): number {
    return fontHeight('', this.ctx);
  }

  textWidth(text: string): number {
    return this.ctx.measureText(text).width;
  }

  save(): void {
    this.ctx.save();
  }

  restore(): void {
    this.ctx.restore();
  }

  translate(x: number, y: number): void {
    this.ctx.translate(x, y);
  }

  /** Rotates by `deg` degrees, clockwise on the screen (QPainter::rotate). */
  rotate(deg: number): void {
    this.ctx.rotate(deg * DEG2RAD);
  }

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  drawLine(x1: number, y1: number, x2: number, y2: number): void {
    if (!this.stroke()) {
      return;
    }
    const o = this.offset();
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x1 + o, y1 + o);
    ctx.lineTo(x2 + o, y2 + o);
    ctx.stroke();
  }

  drawRect(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    if (this.brush) {
      ctx.fillStyle = this.brush;
      ctx.fillRect(x, y, w, h);
    }
    if (this.stroke()) {
      const o = this.offset();
      ctx.strokeRect(x + o, y + o, w, h);
    }
  }

  drawEllipse(x: number, y: number, w: number, h: number): void {
    const o = this.antialias ? 0 : 0.5;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.ellipse(x + w / 2 + o, y + h / 2 + o, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, 2 * Math.PI);
    if (this.rasterized()) {
      if (this.brush) {
        ctx.fillStyle = this.brush;
        ctx.fill();
      }
      this.rasterEllipse(x, y, w, h, 0, 360 * 16);
      return;
    }
    this.fillAndStroke();
  }

  drawArc(x: number, y: number, w: number, h: number, start16: number, span16: number): void {
    if (this.rasterized()) {
      this.rasterEllipse(x, y, w, h, start16, span16);
      return;
    }
    if (!this.stroke()) {
      return;
    }
    this.ctx.beginPath();
    this.arcPath(x, y, w, h, start16, span16);
    this.ctx.stroke();
  }

  drawPie(x: number, y: number, w: number, h: number, start16: number, span16: number): void {
    const o = this.antialias ? 0 : 0.5;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + w / 2 + o, y + h / 2 + o);
    this.arcPath(x, y, w, h, start16, span16);
    ctx.closePath();
    this.fillAndStroke();
  }

  drawPoint(x: number, y: number): void {
    if (this.pen) {
      this.ctx.fillStyle = this.pen.color;
      this.ctx.fillRect(x, y, 1, 1);
    }
  }

  /** Draws text with its baseline at y. */
  drawText(x: number, y: number, text: string): void {
    if (this.pen) {
      this.ctx.fillStyle = this.pen.color;
      this.ctx.textBaseline = 'alphabetic';
      this.ctx.fillText(text, x, y);
    }
  }

  private arcPath(
    x: number,
    y: number,
    w: number,
    h: number,
    start16: number,
    span16: number,
  ): void {
    const o = this.antialias ? 0 : 0.5;
    const start = (-start16 / 16) * DEG2RAD;
    const end = (-(start16 + span16) / 16) * DEG2RAD;
    this.ctx.ellipse(x + w / 2 + o, y + h / 2 + o, w / 2, h / 2, 0, start, end, span16 > 0);
  }

  /** True if curves are drawn pixel by pixel: aliased, thin and solid. */
  private rasterized(): boolean {
    return !this.antialias && this.pen !== null && this.pen.width <= 1 && !this.pen.dot;
  }

  /**
   * Plots a thin aliased ellipse or arc with whole pixels, scanning along
   * the major axis of each octant (8-connected, as Qt's aliased drawing).
   */
  private rasterEllipse(
    x: number,
    y: number,
    w: number,
    h: number,
    start16: number,
    span16: number,
  ): void {
    const pen = this.pen;
    if (!pen) {
      return;
    }
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = Math.abs(w) / 2;
    const ry = Math.abs(h) / 2;
    const start = start16 / 16;
    const span = span16 / 16;
    const full = Math.abs(span) >= 360;
    const { width, height } = this.bounds;
    const seen = new Set<number>();
    const ctx = this.ctx;
    ctx.beginPath();
    const plot = (px: number, py: number) => {
      if (px < -1 || py < -1 || px > width || py > height) {
        return;
      }
      const key = (px + 1) * 65536 + (py + 1);
      if (seen.has(key)) {
        return;
      }
      if (!full) {
        // Qt angles: counter-clockwise on the screen.
        const deg = Math.atan2(cy - py, px - cx) / DEG2RAD;
        const rel = span >= 0 ? deg - start : start - deg;
        if (((rel % 360) + 360) % 360 > Math.abs(span)) {
          return;
        }
      }
      seen.add(key);
      ctx.rect(px, py, 1, 1);
    };
    if (rx < 0.5 || ry < 0.5) {
      plot(Math.round(cx), Math.round(cy));
    } else {
      const d = Math.hypot(rx, ry);
      const ex = (rx * rx) / d;
      const ey = (ry * ry) / d;
      const x0 = Math.max(Math.ceil(cx - ex), -1);
      const x1 = Math.min(Math.floor(cx + ex), width);
      for (let px = x0; px <= x1; ++px) {
        const t = (px - cx) / rx;
        const dy = ry * Math.sqrt(Math.max(0, 1 - t * t));
        plot(px, Math.round(cy - dy));
        plot(px, Math.round(cy + dy));
      }
      const y0 = Math.max(Math.ceil(cy - ey), -1);
      const y1 = Math.min(Math.floor(cy + ey), height);
      for (let py = y0; py <= y1; ++py) {
        const t = (py - cy) / ry;
        const dx = rx * Math.sqrt(Math.max(0, 1 - t * t));
        plot(Math.round(cx - dx), py);
        plot(Math.round(cx + dx), py);
      }
    }
    ctx.fillStyle = pen.color;
    ctx.fill();
  }

  private fillAndStroke(): void {
    if (this.brush) {
      this.ctx.fillStyle = this.brush;
      this.ctx.fill();
    }
    if (this.stroke()) {
      this.ctx.stroke();
    }
  }

  /** Sets up the stroke style. Returns false for Qt::NoPen. */
  private stroke(): boolean {
    const pen = this.pen;
    if (!pen) {
      return false;
    }
    const width = pen.width === 0 ? 1 : pen.width;
    const ctx = this.ctx;
    ctx.strokeStyle = pen.color;
    ctx.lineWidth = width;
    ctx.setLineDash(pen.dot ? [width, 2 * width] : []);
    return true;
  }

  private offset(): number {
    const width = this.pen && this.pen.width > 1 ? this.pen.width : 1;
    return !this.antialias && width % 2 === 1 ? 0.5 : 0;
  }
}

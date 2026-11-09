// Font metrics as Qt's QFontMetrics reports them. Measured against
// rcssmonitor on Linux, Qt rounds the ascent down and the descent up.

let scratch: CanvasRenderingContext2D | null = null;

function measure(font: string, ctx?: CanvasRenderingContext2D): TextMetrics | null {
  const c = ctx ?? (scratch ??= document.createElement('canvas').getContext('2d'));
  if (!c) {
    return null;
  }
  if (!ctx) {
    c.font = font;
  }
  return c.measureText('Mg');
}

/** QFontMetrics::ascent() of a CSS font, or of the current font of `ctx`. */
export function fontAscent(font: string, ctx?: CanvasRenderingContext2D): number {
  const m = measure(font, ctx);
  return m ? Math.floor(m.fontBoundingBoxAscent) : 0;
}

/** QFontMetrics::height(): ascent + descent. */
export function fontHeight(font: string, ctx?: CanvasRenderingContext2D): number {
  const m = measure(font, ctx);
  return m ? Math.floor(m.fontBoundingBoxAscent) + Math.ceil(m.fontBoundingBoxDescent) : 0;
}

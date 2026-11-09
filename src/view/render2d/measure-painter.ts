// The measuring tool: a line between two points with their coordinates, the
// distance and the angle (rcssmonitor FieldCanvas::drawMouseMeasure).
import type { Vec2 } from '../../core/geometry';
import { RAD2DEG } from '../../core/geometry';
import { cssFont } from '../palette';
import type { ViewState } from '../view-state';
import type { QtPainter } from './qt-painter';

export interface Measure {
  /** Screen points in CSS pixels. */
  readonly start: Vec2;
  readonly end: Vec2;
}

export function drawMeasure(
  p: QtPainter,
  view: ViewState,
  m: Measure,
  toField: (x: number, y: number) => Vec2,
): void {
  const { start, end } = m;
  const colors = view.colors;

  p.antialias = false;
  p.setPen(colors.measureLine);
  p.setBrush(null);
  p.drawLine(start.x, start.y, end.x, end.y);
  p.setPen(colors.measureMark);
  p.drawEllipse(start.x - 2, start.y - 2, 4, 4);
  p.drawEllipse(end.x - 2, end.y - 2, 4, 4);
  p.antialias = true;

  p.setFont(cssFont(view.fonts.measure));
  p.setPen(colors.measureFont);
  const s = toField(start.x, start.y);
  p.drawText(start.x, start.y, `(${s.x.toFixed(2)},${s.y.toFixed(2)})`);

  if (Math.abs(start.x - end.x) < 1 && Math.abs(start.y - end.y) < 1) {
    return;
  }
  const e = toField(end.x, end.y);
  p.drawText(end.x, end.y, `(${e.x.toFixed(2)},${e.y.toFixed(2)})`);

  p.setPen(colors.measureFont2);
  const rx = e.x - s.x;
  const ry = e.y - s.y;
  const r = Math.hypot(rx, ry);
  const th = rx === 0 && ry === 0 ? 0 : Math.atan2(ry, rx) * RAD2DEG;
  const dy = end.y > start.y ? p.fontHeight() : -p.fontHeight();
  p.drawText(
    end.x,
    end.y + dy,
    `rel(${rx.toFixed(2)},${ry.toFixed(2)}) r${r.toFixed(2)} th${th.toFixed(1)}`,
  );
}

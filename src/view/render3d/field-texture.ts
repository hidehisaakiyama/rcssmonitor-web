// The field of the 3D view: the 2D field painter (rcssmonitor
// src/field_painter.cpp) draws the pitch on a canvas, which becomes the
// ground's texture. It is drawn at TEXTURE_SCALE pixels per meter with wider
// pens, so that the lines have about their real width; the 3D view builds
// the goals itself.
import type { ServerParam } from '../../core/params';
import { drawField } from '../render2d/field-painter';
import { QtPainter } from '../render2d/qt-painter';
import { Viewport } from '../render2d/viewport';
import type { ViewState } from '../view-state';
import { TEXTURE_AREA, TEXTURE_PEN_SCALE, TEXTURE_SCALE } from './scene-math';

/** What the texture depends on; it is drawn again when this changes. */
export function fieldTextureKey(view: ViewState, sp: ServerParam): string {
  const o = view.options;
  return JSON.stringify([
    view.colors.field,
    view.colors.line,
    o.showFlag,
    o.showKeepawayArea,
    o.gridStep,
    o.showGridCoord,
    view.fonts.player,
    sp.keepaway,
    sp.keepaway_length,
    sp.keepaway_width,
  ]);
}

/** Draws the field on `canvas`, sizing it. */
export function paintFieldTexture(
  canvas: HTMLCanvasElement,
  view: ViewState,
  sp: ServerParam,
): void {
  const width = Math.round(TEXTURE_AREA.length * TEXTURE_SCALE);
  const height = Math.round(TEXTURE_AREA.width * TEXTURE_SCALE);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D is not available');
  }
  const p = new QtPainter(ctx);
  p.bounds = { width, height };
  p.penScale = TEXTURE_PEN_SCALE;
  const vp = new Viewport(width, height, TEXTURE_SCALE, width / 2, height / 2);
  drawField(p, vp, view, sp, { goals: false });
}

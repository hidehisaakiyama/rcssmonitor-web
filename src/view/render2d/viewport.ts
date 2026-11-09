// Field <-> screen coordinates of the 2D view (rcssmonitor
// Options::updateFieldSize, scale, screenX/Y, fieldX/Y). Screen coordinates
// are integers in CSS pixels, as in rcssmonitor.
import { PITCH } from '../../core/constants';
import { rint } from '../../core/geometry';
import { MIN_FIELD_SCALE, type ViewState } from '../view-state';

/** Height kept free for the team logos at the top. */
export const TEAM_GRAPHIC_BAND = 32;

export class Viewport {
  constructor(
    readonly width: number,
    readonly height: number,
    /** Pixels per meter. */
    readonly fieldScale: number,
    readonly centerX: number,
    readonly centerY: number,
  ) {}

  /** A length in meters, in whole pixels. */
  scale(len: number): number {
    return rint(len * this.fieldScale);
  }

  screenX(x: number): number {
    return this.centerX + this.scale(x);
  }

  screenY(y: number): number {
    return this.centerY + this.scale(y);
  }

  fieldX(px: number): number {
    return (px - this.centerX) / this.fieldScale;
  }

  fieldY(py: number): number {
    return (py - this.centerY) / this.fieldScale;
  }
}

/**
 * Computes the viewport for a canvas. While the view is not zoomed, the
 * scale is chosen so that the pitch and its margin fit, and is written back
 * to `view.fieldScale` (rcssmonitor keeps it in the same variable).
 *
 * @param scoreBoardAscent ascent of the score board font, kept free at the bottom
 */
export function layoutViewport(
  view: ViewState,
  width: number,
  height: number,
  scoreBoardAscent: number,
): Viewport {
  const opt = view.options;
  const logoBand = opt.showTeamGraphic ? TEAM_GRAPHIC_BAND : 0;
  let fieldHeight = height - logoBand;
  if (opt.showScoreBoard) {
    fieldHeight -= scoreBoardAscent;
  }

  if (!view.zoomed) {
    const totalLength = PITCH.length + PITCH.margin * 2 + 1;
    const totalWidth = PITCH.width + PITCH.margin * 2;
    let scale = width / totalLength;
    if (totalWidth * scale > fieldHeight) {
      scale = fieldHeight / totalWidth;
    }
    scale = Math.max(scale, MIN_FIELD_SCALE);
    view.fieldScale = rint(scale * 100) / 100;
  }

  const scale = view.fieldScale;
  return new Viewport(
    width,
    height,
    scale,
    Math.trunc(width / 2) - rint(view.focusPoint.x * scale),
    logoBand + Math.trunc(fieldHeight / 2) - rint(view.focusPoint.y * scale),
  );
}

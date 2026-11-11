// The pitch (rcssmonitor src/field_painter.cpp).
import { PITCH } from '../../core/constants';
import { RAD2DEG } from '../../core/geometry';
import type { ServerParam } from '../../core/params';
import type { ViewState } from '../view-state';
import type { QtPainter } from './qt-painter';
import type { Viewport } from './viewport';

const HALF_LENGTH = PITCH.length * 0.5;
const HALF_WIDTH = PITCH.width * 0.5;

export interface FieldOptions {
  /** The goals as boxes behind the goal lines (default). The 3D view builds its own. */
  readonly goals?: boolean;
  /** Drawn over the field color, under the lines (the 3D view's mowed stripes). */
  readonly grass?: (p: QtPainter, vp: Viewport) => void;
}

export function drawField(
  p: QtPainter,
  vp: Viewport,
  view: ViewState,
  sp: ServerParam,
  options: FieldOptions = {},
): void {
  p.antialias = false;
  p.fillRect(0, 0, vp.width, vp.height, view.colors.field);
  options.grass?.(p, vp);
  drawLines(p, vp, view, sp);
  drawPenaltyAreaLines(p, vp, view);
  drawGoalAreaLines(p, vp, view);
  if (options.goals ?? true) {
    drawGoals(p, vp);
  }
  if (view.options.showFlag) {
    drawFlags(p, vp, view);
  }
  if (view.options.gridStep > 0) {
    drawGrid(p, vp, view);
  }
  p.antialias = true;
}

function drawLines(p: QtPainter, vp: Viewport, view: ViewState, sp: ServerParam): void {
  p.setPen(view.colors.line);
  p.setBrush(null);

  const leftX = vp.screenX(-HALF_LENGTH);
  const rightX = vp.screenX(+HALF_LENGTH);
  const topY = vp.screenY(-HALF_WIDTH);
  const bottomY = vp.screenY(+HALF_WIDTH);

  p.drawLine(leftX, topY, rightX, topY);
  p.drawLine(rightX, topY, rightX, bottomY);
  p.drawLine(rightX, bottomY, leftX, bottomY);
  p.drawLine(leftX, bottomY, leftX, topY);

  // "keepaway" in server_param (rcssmonitor reads it into keepaway_mode_).
  if (sp.keepaway || view.options.showKeepawayArea) {
    // The keepaway area instead of the center line and circle.
    p.drawRect(
      vp.screenX(-sp.keepaway_length * 0.5),
      vp.screenY(-sp.keepaway_width * 0.5),
      vp.scale(sp.keepaway_length),
      vp.scale(sp.keepaway_width),
    );
  } else {
    p.drawLine(vp.centerX, topY, vp.centerX, bottomY);
    const r = vp.scale(PITCH.centerCircleRadius);
    p.drawEllipse(vp.centerX - r, vp.centerY - r, r * 2, r * 2);
  }

  // corner arcs
  const r = vp.scale(PITCH.cornerArcRadius);
  p.drawArc(leftX - r, topY - r, r * 2, r * 2, -90 * 16, 90 * 16);
  p.drawArc(leftX - r, bottomY - r, r * 2, r * 2, 0 * 16, 90 * 16);
  p.drawArc(rightX - r, bottomY - r, r * 2, r * 2, 90 * 16, 90 * 16);
  p.drawArc(rightX - r, topY - r, r * 2, r * 2, 180 * 16, 90 * 16);
}

function drawPenaltyAreaLines(p: QtPainter, vp: Viewport, view: ViewState): void {
  p.setPen(view.colors.line);
  p.setBrush(null);

  const leftX = vp.screenX(-HALF_LENGTH);
  const rightX = vp.screenX(+HALF_LENGTH);
  const topY = vp.screenY(-PITCH.penaltyAreaWidth * 0.5);
  const bottomY = vp.screenY(+PITCH.penaltyAreaWidth * 0.5);

  // The arc outside the penalty area.
  const arcHalfDeg =
    Math.acos((PITCH.penaltyAreaLength - PITCH.penaltySpotDist) / PITCH.penaltyCircleRadius) *
    RAD2DEG;
  const span = Math.round(arcHalfDeg * 2 * 16);
  const r = vp.scale(PITCH.penaltyCircleRadius);
  const size = vp.scale(PITCH.penaltyCircleRadius * 2);

  // left
  let penX = vp.screenX(-(HALF_LENGTH - PITCH.penaltyAreaLength));
  let spotX = vp.screenX(-(HALF_LENGTH - PITCH.penaltySpotDist));
  p.drawArc(spotX - r + 1, vp.centerY - r, size, size, Math.round(-arcHalfDeg * 16), span);
  p.drawLine(leftX, topY, penX, topY);
  p.drawLine(penX, topY, penX, bottomY);
  p.drawLine(penX, bottomY, leftX, bottomY);
  p.drawPoint(spotX, vp.centerY);

  // right
  penX = vp.screenX(+(HALF_LENGTH - PITCH.penaltyAreaLength));
  spotX = vp.screenX(+(HALF_LENGTH - PITCH.penaltySpotDist));
  p.drawArc(spotX - r, vp.centerY - r, size, size, Math.round((180 - arcHalfDeg + 0.5) * 16), span);
  p.drawLine(rightX, topY, penX, topY);
  p.drawLine(penX, topY, penX, bottomY);
  p.drawLine(penX, bottomY, rightX, bottomY);
  p.drawPoint(spotX, vp.centerY);
}

function drawGoalAreaLines(p: QtPainter, vp: Viewport, view: ViewState): void {
  p.setPen(view.colors.line);
  p.setBrush(null);

  const leftX = vp.screenX(-HALF_LENGTH);
  const rightX = vp.screenX(+HALF_LENGTH);
  const yAbs = vp.scale(PITCH.goalAreaWidth * 0.5);
  const topY = vp.centerY - yAbs;
  const bottomY = vp.centerY + yAbs;

  let x = vp.screenX(-HALF_LENGTH + PITCH.goalAreaLength);
  p.drawLine(leftX, topY, x, topY);
  p.drawLine(x, topY, x, bottomY);
  p.drawLine(x, bottomY, leftX, bottomY);

  x = vp.screenX(HALF_LENGTH - PITCH.goalAreaLength);
  p.drawLine(rightX, topY, x, topY);
  p.drawLine(x, topY, x, bottomY);
  p.drawLine(x, bottomY, rightX, bottomY);
}

function drawGoals(p: QtPainter, vp: Viewport): void {
  p.setPen('#000000');
  p.setBrush('#000000');

  const goalTopY = vp.screenY(-PITCH.goalWidth * 0.5);
  const sizeX = vp.scale(PITCH.goalDepth);
  const sizeY = vp.scale(PITCH.goalWidth);
  const postTopY = vp.screenY(-PITCH.goalWidth * 0.5 - PITCH.goalPostRadius * 2);
  const postBottomY = vp.screenY(+PITCH.goalWidth * 0.5);
  const postDiameter = vp.scale(PITCH.goalPostRadius * 2);

  p.drawRect(vp.screenX(-HALF_LENGTH - PITCH.goalDepth) - 1, goalTopY, sizeX, sizeY);
  if (postDiameter >= 1) {
    const x = vp.screenX(-HALF_LENGTH);
    p.drawEllipse(x, postTopY, postDiameter, postDiameter);
    p.drawEllipse(x, postBottomY, postDiameter, postDiameter);
  }

  p.drawRect(vp.screenX(HALF_LENGTH) + 1, goalTopY, sizeX, sizeY);
  if (postDiameter >= 1) {
    const x = vp.screenX(HALF_LENGTH - PITCH.goalPostRadius * 2);
    p.drawEllipse(x, postTopY, postDiameter, postDiameter);
    p.drawEllipse(x, postBottomY, postDiameter, postDiameter);
  }
}

/** The 55 flags (landmarks) players can see. */
function drawFlags(p: QtPainter, vp: Viewport, view: ViewState): void {
  p.setPen(view.colors.line);
  p.setBrush(null);

  const r = Math.min(5, Math.max(2, vp.scale(0.5)));
  const d = r * 2;
  const cx = vp.centerX;
  const cy = vp.centerY;
  const halfLength = vp.scale(HALF_LENGTH);
  const halfWidth = vp.scale(HALF_WIDTH);
  const marginX = vp.scale(HALF_LENGTH + PITCH.margin);
  const marginY = vp.scale(HALF_WIDTH + PITCH.margin);
  const penaltyX = vp.scale(HALF_LENGTH - PITCH.penaltyAreaLength);
  const penaltyY = vp.scale(PITCH.penaltyAreaWidth * 0.5);
  const goalY = vp.scale(PITCH.goalWidth * 0.5);
  const s = [10, 20, 30, 40, 50].map((m) => vp.scale(m));
  const [s10 = 0, s20 = 0, s30 = 0, s40 = 0, s50 = 0] = s;

  const points: [number, number][] = [
    [-halfLength, 0], // goal l
    [halfLength, 0], // goal r
    [0, 0], // center
    [0, -halfWidth], // center top
    [0, halfWidth], // center bottom
    [-halfLength, -halfWidth], // corners
    [-halfLength, halfWidth],
    [halfLength, -halfWidth],
    [halfLength, halfWidth],
    [-penaltyX, -penaltyY], // penalty areas
    [-penaltyX, 0],
    [-penaltyX, penaltyY],
    [penaltyX, -penaltyY],
    [penaltyX, 0],
    [penaltyX, penaltyY],
    [-halfLength, -goalY], // goal posts
    [-halfLength, goalY],
    [halfLength, -goalY],
    [halfLength, goalY],
  ];
  const along = [-s50, -s40, -s30, -s20, -s10, 0, s10, s20, s30, s40, s50];
  for (const x of along) {
    points.push([x, -marginY]);
  }
  for (const x of along) {
    points.push([x, marginY]);
  }
  const side = [-s30, -s20, -s10, 0, s10, s20, s30];
  for (const y of side) {
    points.push([-marginX, y]);
  }
  for (const y of side) {
    points.push([marginX, y]);
  }

  for (const [x, y] of points) {
    p.drawEllipse(cx + x - r, cy + y - r, d, d);
  }
}

function drawGrid(p: QtPainter, vp: Viewport, view: ViewState): void {
  const step = view.options.gridStep;
  const istep = vp.scale(step);
  if (istep <= 2) {
    return;
  }
  // rcssmonitor draws the labels with the application font (10 pt).
  p.setFont(`13px ${view.fonts.measure.family}`);
  const textStepX = view.options.showGridCoord ? p.textWidth('-00.000') : 100000;
  const ascent = p.fontAscent();
  const textStepY = view.options.showGridCoord ? ascent : 100000;

  const maxIx = vp.width - 1;
  const minIx = 0;
  const maxIy = vp.height - 1;
  const minIy = 0;
  const maxX = vp.fieldX(maxIx);
  const minX = vp.fieldX(minIx);
  const maxY = vp.fieldY(maxIy);
  const minY = vp.fieldY(minIy);
  const coordXPrintY = minIy + ascent;

  p.setPen(view.colors.line);
  p.setBrush(null);

  const vertical = (x: number) => {
    const ix = vp.screenX(x);
    if (istep > textStepX) {
      p.drawText(ix, coordXPrintY, x.toFixed(3));
    }
    p.drawLine(ix, maxIy, ix, minIy);
  };
  const horizontal = (y: number) => {
    const iy = vp.screenY(y);
    if (istep > textStepY) {
      p.drawText(minIx, iy, y.toFixed(3));
    }
    p.drawLine(maxIx, iy, minIx, iy);
  };
  for (let x = 0; x < maxX; x += step) {
    vertical(x);
  }
  for (let x = -step; minX < x; x -= step) {
    vertical(x);
  }
  for (let y = 0; y < maxY; y += step) {
    horizontal(y);
  }
  for (let y = -step; minY < y; y -= step) {
    horizontal(y);
  }
}

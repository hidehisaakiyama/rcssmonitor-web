// The compass and the minimap over the 3D view (DEVELOPMENT_PLAN.md,
// Phase 6), optional, to tell which way the camera looks:
// - The compass: a strip at the top with the 360 degrees around the camera
//   direction, the directions of the goals (L, R, in the team colors) and of
//   the ball, and the camera's horizontal field of view brighter. Angles are
//   field directions (clockwise on the 2D screen), so clockwise from the
//   camera direction is to the right.
// - The minimap: the pitch at the bottom right as the 2D view shows it, with
//   the players, the ball, and where the camera is and what it sees. It
//   shows everything, whatever the player camera's sight: it is the map of
//   the game.
// The 3D renderer tells the HUD where the camera is (CameraGuide).
import { PITCH } from '../../core/constants';
import { isAlive, type Frame } from '../../core/frame';
import { DEG2RAD, normalizeAngle, vectorAngle, type Vec2 } from '../../core/geometry';
import type { ServerParam } from '../../core/params';
import { drawField } from '../render2d/field-painter';
import { QtPainter } from '../render2d/qt-painter';
import { Viewport } from '../render2d/viewport';
import type { CameraMode } from '../render3d/cameras';
import { fieldTextureKey } from '../render3d/field-texture';
import { playerColor, TEXTURE_AREA, textColorOn } from '../render3d/scene-math';
import type { ViewState } from '../view-state';

/** When a guide shows: never, with the player camera, or with every camera but the top one. */
export const GUIDE_MODES = ['off', 'player', 'all'] as const;
export type GuideMode = (typeof GUIDE_MODES)[number];

/** Where the 3D camera is and looks, and which guides to draw. */
export interface CameraGuide {
  /** Field coordinates. */
  readonly x: number;
  readonly y: number;
  /** The field direction the camera looks in, in degrees. */
  readonly direction: number;
  /** The horizontal field of view, in degrees. */
  readonly fov: number;
  readonly compass: boolean;
  readonly minimap: boolean;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Whether a guide in `mode` shows with the `camera` (not the top one: it is a map already). */
export function guideShown(mode: GuideMode, camera: CameraMode): boolean {
  return camera !== 'top' && (mode === 'all' || (mode === 'player' && camera === 'player'));
}

/** The field direction from `from` to `to`, in degrees. */
export function bearing(from: Vec2, to: Vec2): number {
  return vectorAngle(to.x - from.x, to.y - from.y);
}

/** Where a field direction is on the compass, -1 (left end) to 1 (right end), the camera direction at 0. */
export function compassOffset(direction: number, cameraDirection: number): number {
  return normalizeAngle(direction - cameraDirection) / 180;
}

/** The compass strip on a canvas `width` wide: at the top, in the middle. */
export function compassRect(width: number): Rect {
  const w = Math.round(Math.min(480, width * 0.6));
  return { x: Math.round((width - w) / 2), y: 6, width: w, height: 22 };
}

/** The minimap at the bottom right, the pitch and its margin; `scale` in pixels per meter. */
export function minimapRect(width: number, height: number): Rect & { readonly scale: number } {
  const w = Math.round(Math.min(300, Math.max(140, width * 0.24)));
  const h = Math.round((w * TEXTURE_AREA.width) / TEXTURE_AREA.length);
  return {
    x: width - w - 8,
    y: height - h - 8,
    width: w,
    height: h,
    scale: w / TEXTURE_AREA.length,
  };
}

/** A field point on the minimap. */
export function minimapPoint(r: Rect & { readonly scale: number }, p: Vec2): Vec2 {
  return { x: r.x + r.width / 2 + p.x * r.scale, y: r.y + r.height / 2 + p.y * r.scale };
}

/** The goals' centers. */
const LEFT_GOAL: Vec2 = { x: -PITCH.length / 2, y: 0 };
const RIGHT_GOAL: Vec2 = { x: PITCH.length / 2, y: 0 };

/** Where the marks are on the compass (canvas x), for the tests. */
export interface CompassMarks {
  readonly left: number;
  readonly right: number;
  readonly ball: number | null;
}

/** Draws the compass in `r` and returns where its marks are. */
export function drawCompass(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  guide: CameraGuide,
  view: ViewState,
  ball: Vec2 | null,
): CompassMarks {
  const center = r.x + r.width / 2;
  const at = (direction: number) =>
    center + compassOffset(direction, guide.direction) * (r.width / 2);
  const camera = { x: guide.x, y: guide.y };
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.width, r.height, 4);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fill();
  ctx.clip();
  // What the camera sees.
  const band = (Math.min(360, guide.fov) / 360) * r.width;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.fillRect(center - band / 2, r.y, band, r.height);
  // Ticks every 15 degrees of the field, longer every 45 and 90.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let d = 0; d < 360; d += 15) {
    const x = Math.round(at(d)) + 0.5;
    const length = d % 90 === 0 ? 9 : d % 45 === 0 ? 6 : 3;
    ctx.moveTo(x, r.y + r.height);
    ctx.lineTo(x, r.y + r.height - length);
  }
  ctx.stroke();
  // The camera direction.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(center - 5, r.y);
  ctx.lineTo(center + 5, r.y);
  ctx.lineTo(center, r.y + 6);
  ctx.closePath();
  ctx.fill();

  const marks: CompassMarks = {
    left: at(bearing(camera, LEFT_GOAL)),
    right: at(bearing(camera, RIGHT_GOAL)),
    ball: ball ? at(bearing(camera, ball)) : null,
  };
  const middle = r.y + r.height / 2;
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [x, color, label] of [
    [marks.left, view.colors.leftTeam, 'L'],
    [marks.right, view.colors.rightTeam, 'R'],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, middle, 8, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.stroke();
    ctx.fillStyle = textColorOn(color);
    ctx.fillText(label, x, middle + 1);
  }
  if (marks.ball !== null) {
    ctx.beginPath();
    ctx.arc(marks.ball, middle, 4, 0, 2 * Math.PI);
    ctx.fillStyle = view.colors.ball;
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.stroke();
  }
  ctx.restore();
  return marks;
}

/** The minimap's pitch, drawn by the 2D field painter, again only when it changes. */
export class MinimapField {
  readonly canvas = document.createElement('canvas');
  private key = '';

  image(view: ViewState, sp: ServerParam, r: Rect & { readonly scale: number }, dpr: number) {
    const key = `${fieldTextureKey(view, sp)}|${r.width}x${r.height}@${dpr}`;
    if (key !== this.key) {
      this.key = key;
      const c = this.canvas;
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const p = new QtPainter(ctx);
        p.bounds = { width: r.width, height: r.height };
        const vp = new Viewport(r.width, r.height, r.scale, r.width / 2, r.height / 2);
        drawField(p, vp, view, sp);
      }
    }
    return this.canvas;
  }
}

/** Draws the minimap in `r`: the pitch, the camera's view, the players and the ball. */
export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  r: Rect & { readonly scale: number },
  guide: CameraGuide,
  view: ViewState,
  frame: Frame | null,
  field: HTMLCanvasElement,
): void {
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.drawImage(field, r.x, r.y, r.width, r.height);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.width, r.height);
  ctx.clip();
  // What the camera sees, to beyond the corners (it may be outside).
  const c = minimapPoint(r, guide);
  const half = (Math.min(359, guide.fov) / 2) * DEG2RAD;
  const a = guide.direction * DEG2RAD;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.arc(c.x, c.y, 4 * (r.width + r.height), a - half, a + half);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const dot = (p: Vec2, radius: number, fill: string) => {
    const q = minimapPoint(r, p);
    ctx.beginPath();
    ctx.arc(q.x, q.y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.stroke();
    return q;
  };
  const radius = Math.max(2.5, r.scale * 1.2);
  if (frame) {
    for (const p of frame.players) {
      if (!isAlive(p)) {
        continue;
      }
      const q = dot(p, radius, playerColor(view.colors, p));
      if (view.isSelected(p.side, p.unum)) {
        ctx.beginPath();
        ctx.arc(q.x, q.y, radius + 2, 0, 2 * Math.PI);
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    }
    dot(frame.ball, Math.max(2, radius * 0.7), view.colors.ball);
  }
  // The camera.
  dot(guide, 3.5, '#ffffff');
  ctx.restore();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.width - 1, r.height - 1);
}

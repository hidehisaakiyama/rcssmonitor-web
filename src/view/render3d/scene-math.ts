// The geometry of the 3D view, without three.js, so that it can be tested.
//
// Field coordinates (x to the right, y down on the 2D screen, angles
// clockwise on the screen) map to three.js world coordinates as
// X = x, Z = y and Y = height. Seen from above with -Z up, the 3D view
// shows the field as the 2D view does.
import { PITCH, Side } from '../../core/constants';
import { isAlive, isGoalie, type BallState, type PlayerState } from '../../core/frame';
import { DEG2RAD } from '../../core/geometry';
import type { PlayerType, ServerParam } from '../../core/params';
import type { Palette } from '../palette';
import type { ViewOptions } from '../view-state';

export interface World {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A field point at a height, in world coordinates. */
export function toWorld(x: number, y: number, height = 0): World {
  return { x, y: height, z: y };
}

/**
 * The rotation about the world Y axis that turns +X to a field direction
 * (degrees, clockwise on the screen). Rotating by a about Y takes +X to
 * (cos a, 0, -sin a), so the field direction d needs a = -d.
 */
export function yaw(directionDeg: number): number {
  return -directionDeg * DEG2RAD;
}

/** The height of the goals (crossbar), when the server does not give one. */
export const GOAL_HEIGHT = 2.44;

/** The ball's radius: the view option, or the real size below 0.01 (as in 2D). */
export function ballRadius(options: ViewOptions, sp: ServerParam): number {
  return options.ballSize >= 0.01 ? options.ballSize : sp.ball_size;
}

/** The height of the ball's center: on the ground unless the show has a height. */
export function ballCenterHeight(ball: BallState, radius: number): number {
  return Math.max(0, ball.z ?? 0) + radius;
}

/**
 * The shadow's opacity: darkest on the ground, fading with the height so
 * that a high ball still shows where it is above the field.
 */
export function shadowOpacity(ball: BallState): number {
  const h = Math.max(0, ball.z ?? 0);
  return 0.45 / (1 + h / 4);
}

/** Sizes of a player figure in meters. */
export interface PlayerSize {
  /** Body radius: the player type's size. */
  readonly body: number;
  /** The circle on the ground: the kickable area, or the Player Size option. */
  readonly ground: number;
}

export function playerSize(options: ViewOptions, sp: ServerParam, type: PlayerType): PlayerSize {
  const kickable = type.player_size + type.kickable_margin + sp.ball_size;
  return {
    body: type.player_size,
    ground: options.playerSize >= 0.01 ? options.playerSize : kickable,
  };
}

/** The player's color, as the 2D view fills the body (PlayerPainter::drawBody). */
export function playerColor(colors: Palette, p: PlayerState): string {
  if (!isAlive(p)) {
    return '#000000';
  }
  if (p.side === Side.Left) {
    return isGoalie(p) ? colors.leftGoalie : colors.leftTeam;
  }
  if (p.side === Side.Right) {
    return isGoalie(p) ? colors.rightGoalie : colors.rightTeam;
  }
  return '#000000';
}

/** Degrees above the ground of the broadcast-like default camera. */
export const CAMERA_ELEVATION = 32;

/**
 * The default camera: on the near side (+Z), looking at the center at
 * CAMERA_ELEVATION degrees, as close as it can be with the pitch (and 2 m
 * around it) inside the canvas of `aspect` (width / height). Vertically it
 * keeps 15% free for the team logos and the score board.
 *
 * With the camera at distance D, a ground point (X, Z) projects to
 *   ndcX = X / ((D - Z cos e) tan(h)),  ndcY = -Z sin e / ((D - Z cos e) tan(v))
 * (h, v: half the horizontal and vertical fields of view, e: the elevation).
 * The near corners (Z = +b) are the widest and the lowest.
 */
export function fitCameraPosition(
  verticalFovDeg: number,
  aspect: number,
): { position: World; target: World } {
  const tanV = Math.tan((verticalFovDeg * DEG2RAD) / 2);
  const tanH = tanV * aspect;
  const e = CAMERA_ELEVATION * DEG2RAD;
  const a = PITCH.length / 2 + 2;
  const b = PITCH.width / 2 + 2;
  const across = a / (0.97 * tanH) + b * Math.cos(e);
  const down = (b * Math.sin(e)) / (0.85 * tanV) + b * Math.cos(e);
  const distance = Math.max(across, down);
  return {
    position: { x: 0, y: distance * Math.sin(e), z: distance * Math.cos(e) },
    target: { x: 0, y: 0, z: 0 },
  };
}

/** The area the field texture covers: the pitch and its margin, centered on the origin. */
export const TEXTURE_AREA = {
  length: PITCH.length + 2 * PITCH.margin,
  width: PITCH.width + 2 * PITCH.margin,
} as const;

/** Pixels per meter of the field texture. */
export const TEXTURE_SCALE = 24;

/**
 * Pens on the texture are this many pixels per 2D pixel: 3 / 24 m = 12.5 cm,
 * about the real width of the lines.
 */
export const TEXTURE_PEN_SCALE = 3;

/**
 * The boards around the pitch: just outside the margin (where the players
 * can go), as high as real ones. Along the touch lines they change color at
 * the halfway line, so that either side shows which half it is, wherever a
 * camera looks. They are a dark shade of the team color with the team name
 * in the team color (BOARD_SHADE), so that the players, in the team colors,
 * stand out against them.
 */
export const BOARDS = Object.freeze({
  /** From the touch lines and the goal lines, in meters. */
  offset: PITCH.margin + 0.5,
  height: 1,
  /** The team name is written once in every this many meters. */
  tile: 10,
});

/** How bright the boards and the banners are, of the team color. */
export const BOARD_SHADE = 0.32;

/**
 * The banner behind each goal, with the team name and logo, to be seen from
 * the other end. It floats high above the goal, so that the goal stands out
 * against the sky and the ground beyond it, not against the banner; and it
 * is behind the goal camera (cameras.ts: 18 m behind the goal line), so that
 * it does not hide the pitch from it.
 */
export const BANNER = Object.freeze({ behind: 22, width: 50, height: 8, bottom: 12 });

/** `color` (#rgb, #rrggbb or rgb(r, g, b)) times `k`, as #rrggbb; `color` itself if it cannot read it. */
export function shade(color: string, k: number): string {
  const c = parseRgb(color);
  if (!c) {
    return color;
  }
  const hex = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v * k)))
      .toString(16)
      .padStart(2, '0');
  return `#${c.map(hex).join('')}`;
}

/**
 * Black or white, whichever reads better on a color (#rgb, #rrggbb or
 * rgb(r, g, b)): black above the relative luminance where both contrast
 * equally (WCAG), and for colors it cannot read.
 */
export function textColorOn(color: string): '#000000' | '#ffffff' {
  const c = parseRgb(color);
  if (!c) {
    return '#000000';
  }
  const linear = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
  return l > 0.179 ? '#000000' : '#ffffff';
}

function parseRgb(color: string): [number, number, number] | null {
  const s = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((h) => h + h).join('') : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The stamina left, of stamina_max (0-1): the length of the stamina bar. */
export function staminaRate(player: PlayerState, sp: ServerParam): number {
  return sp.stamina_max > 0 ? clamp01(player.stamina / sp.stamina_max) : 0;
}

/** The stamina capacity left, of stamina_capacity (0-1); null without one (text v4 logs). */
export function capacityRate(player: PlayerState, sp: ServerParam): number | null {
  return player.capacity === undefined || sp.stamina_capacity <= 0
    ? null
    : clamp01(player.capacity / sp.stamina_capacity);
}

/**
 * The hue of the stamina bar (degrees): red at or below the stamina where
 * the recovery or the effort starts to fall (recover_dec_thr,
 * effort_dec_thr of stamina_max), to green when full.
 */
export function staminaHue(rate: number, sp: ServerParam): number {
  const threshold = Math.max(sp.recover_dec_thr, sp.effort_dec_thr);
  return threshold >= 1 ? 0 : 120 * clamp01((rate - threshold) / (1 - threshold));
}

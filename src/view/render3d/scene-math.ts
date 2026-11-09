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

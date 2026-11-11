// What the overlays of the players and the ball show, shared by the 2D view
// (render2d/player-painter.ts, ball-painter.ts: rcssmonitor
// src/player_painter.cpp, src/ball_painter.cpp) and the 3D view
// (render3d/overlays.ts), in field coordinates and degrees.
import { MAX_PLAYER, PITCH, Side } from '../core/constants';
import type { BallState, Frame, PlayerState } from '../core/frame';
import { formatG } from '../core/number-format';
import {
  circleIntersections,
  isLeftOf,
  normalizeAngle,
  rotate,
  vectorAngle,
  type Vec2,
} from '../core/geometry';
import type { PlayerType, ServerParam } from '../core/params';

/** Where the player looks with its focus (attentionto by the eyes), if it does. */
export function focusPointOf(player: PlayerState): Vec2 | null {
  const fp = player.focusPoint;
  if (!fp || fp.dist <= 1.0e-5) {
    return null;
  }
  const angle = ((player.body + player.neck + fp.dir) * Math.PI) / 180;
  return { x: player.x + fp.dist * Math.cos(angle), y: player.y + fp.dist * Math.sin(angle) };
}

/**
 * The goalie's catchable area: the radius reaching the far corners of the
 * catch box, and with a catchable_area_l_stretch over 1, the largest and the
 * smallest by the stretch.
 */
export function catchAreaRadii(
  sp: ServerParam,
  type: PlayerType,
): { readonly catchable: number; readonly stretched: readonly [number, number] | null } {
  const halfWidth = sp.catchable_area_w * 0.5;
  const catchable = Math.hypot(halfWidth, sp.catchable_area_l);
  const stretch = type.catchable_area_l_stretch;
  const max = Math.hypot(halfWidth, sp.catchable_area_l * stretch);
  if (max <= catchable) {
    return { catchable, stretched: null };
  }
  const min = Math.hypot(halfWidth, sp.catchable_area_l * (1.0 - (stretch - 1.0)));
  return { catchable, stretched: [max, min] };
}

/**
 * How likely a tackle and a foul succeed now (0-1), each null when it
 * cannot; null when neither can, or the server has no tackle distance.
 */
export function tackleChances(
  sp: ServerParam,
  player: PlayerState,
  ball: BallState,
): { readonly tackle: number | null; readonly foul: number | null } | null {
  const rel = rotate({ x: ball.x - player.x, y: ball.y - player.y }, -player.body);
  const tackleDist = rel.x > 0 ? sp.tackle_dist : sp.tackle_back_dist;
  if (tackleDist < 1.0e-5) {
    return null;
  }
  const tackleFail =
    (Math.abs(rel.x) / tackleDist) ** sp.tackle_exponent +
    (Math.abs(rel.y) / sp.tackle_width) ** sp.tackle_exponent;
  const foulFail =
    (Math.abs(rel.x) / tackleDist) ** sp.foul_exponent +
    (Math.abs(rel.y) / sp.tackle_width) ** sp.foul_exponent;
  if (tackleFail >= 1.0 && foulFail >= 1.0) {
    return null;
  }
  return {
    tackle: tackleFail < 1.0 ? 1.0 - tackleFail : null,
    foul: foulFail < 1.0 ? 1.0 - foulFail : null,
  };
}

/** The text of the tackle area, as rcssmonitor writes it. */
export function tackleText(chances: {
  readonly tackle: number | null;
  readonly foul: number | null;
}): string {
  const { tackle, foul } = chances;
  if (tackle !== null && foul !== null) {
    return `T=${qtNumber(tackle)},F=${qtNumber(foul)}`;
  }
  return tackle !== null ? `Tackle=${qtNumber(tackle)}` : `Foul=${qtNumber(foul ?? 0)}`;
}

/** An arc: around `center`, from `start` degrees clockwise on the 2D screen by `span` (0-360). */
export interface Arc {
  readonly center: Vec2;
  readonly radius: number;
  readonly start: number;
  readonly span: number;
}

/**
 * The arc from one of two directions to the other that passes `toward`:
 * it starts at the one counter-clockwise of `toward` and goes clockwise.
 */
export function arcThrough(
  a1: number,
  a2: number,
  toward: number,
): { start: number; span: number } {
  const [start, end] = isLeftOf(a1, toward) ? [a1, a2] : [a2, a1];
  let span = normalizeAngle(end - start);
  if (span < 0) {
    span += 360;
  }
  return { start, span };
}

/**
 * Where the selected player can kick the ball to, if it is kickable: the
 * ball's next place without noise, the largest acceleration, and the arcs
 * that bound where the ball can be next (within ball_speed_max of the ball
 * and the largest acceleration of its next place), or the circle of that
 * acceleration when they do not cross.
 */
export function kickAccel(
  sp: ServerParam,
  type: PlayerType,
  player: PlayerState,
  ball: BallState,
): { readonly next: Vec2; readonly maxAccel: number; readonly arcs: readonly Arc[] } | null {
  const rel = rotate({ x: ball.x - player.x, y: ball.y - player.y }, -player.body);
  const ballDist = Math.hypot(rel.x, rel.y);
  if (ballDist > type.player_size + type.kickable_margin + sp.ball_size) {
    return null;
  }
  const dirDiff = Math.abs(vectorAngle(rel.x, rel.y));
  const maxAccel = Math.min(
    sp.maxpower *
      type.kick_power_rate *
      (1.0 -
        (0.25 * dirDiff) / 180.0 -
        (0.25 * (ballDist - type.player_size - sp.ball_size)) / type.kickable_margin),
    sp.ball_accel_max,
  );
  const bpos = { x: ball.x, y: ball.y };
  const next = { x: bpos.x + ball.vx, y: bpos.y + ball.vy };
  const points = circleIntersections(bpos, sp.ball_speed_max, next, maxAccel);
  const [i1, i2] = points;
  if (points.length !== 2 || !i1 || !i2) {
    return { next, maxAccel, arcs: [{ center: next, radius: maxAccel, start: 0, span: 360 }] };
  }
  const toNext = vectorAngle(next.x - bpos.x, next.y - bpos.y);
  const speed = arcThrough(
    vectorAngle(i1.x - bpos.x, i1.y - bpos.y),
    vectorAngle(i2.x - bpos.x, i2.y - bpos.y),
    toNext,
  );
  const accel = arcThrough(
    vectorAngle(i1.x - next.x, i1.y - next.y),
    vectorAngle(i2.x - next.x, i2.y - next.y),
    normalizeAngle(toNext + 180.0),
  );
  return {
    next,
    maxAccel,
    arcs: [
      { center: bpos, radius: sp.ball_speed_max, ...speed },
      { center: next, radius: maxAccel, ...accel },
    ],
  };
}

/**
 * The ball's path without noise for up to `cycles` cycles (at most 100),
 * until it moves less than `minStep` meters in a cycle: the places after
 * each cycle.
 */
export function ballPath(
  sp: ServerParam,
  ball: BallState,
  cycles: number,
  minStep: number,
): Vec2[] {
  const path: Vec2[] = [];
  let { x, y, vx, vy } = ball;
  for (let i = 0; i < Math.min(100, cycles); ++i) {
    if (Math.hypot(vx, vy) < minStep) {
      break;
    }
    x += vx;
    y += vy;
    vx *= sp.ball_decay;
    vy *= sp.ball_decay;
    path.push({ x, y });
  }
  return path;
}

/** QString::arg(value, 0, 'g', 3): up to 3 significant digits, no trailing zeros. */
export function qtNumber(v: number): string {
  return v === 0 ? '0' : formatG(v, 3);
}

/**
 * The offside lines: the second last defender of each team, or the ball if
 * it is further back, and not beyond the goal line.
 */
export function offsideLines(frame: Frame): [number, number] {
  let offsideL = 0;
  let minX = 0;
  let offsideR = 0;
  let maxX = 0;
  for (let i = 0; i < 2 * MAX_PLAYER; ++i) {
    const p = frame.players[i];
    if (!p || p.state === 0) {
      continue;
    }
    if (p.side === Side.Left && p.x < offsideL) {
      if (p.x < minX) {
        offsideL = minX;
        minX = p.x;
      } else {
        offsideL = p.x;
      }
    } else if (p.side === Side.Right && offsideR < p.x) {
      if (maxX < p.x) {
        offsideR = maxX;
        maxX = p.x;
      } else {
        offsideR = p.x;
      }
    }
  }
  const half = PITCH.length * 0.5;
  return [
    Math.max(Math.min(offsideL, frame.ball.x), -half),
    Math.min(Math.max(offsideR, frame.ball.x), half),
  ];
}

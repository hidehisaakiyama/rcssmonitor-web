// Interpolation between two frames for the 3D view (§4.3). Positions are
// linear, the body direction turns the short way round. A play mode change
// is not interpolated (the server may have moved everyone), nor is an
// object that jumped further than it can move in one cycle (a move command,
// a free kick placement).
import { isAlive, type BallState, type Frame, type PlayerState } from '../../core/frame';
import { normalizeAngle } from '../../core/geometry';

/** Farther than a player can go in a cycle (player_speed_max is about 1.05-1.2 m). */
export const MAX_PLAYER_STEP = 3;
/** Farther than the ball can go in a cycle (ball_speed_max is 3 m). */
export const MAX_BALL_STEP = 4;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** From `a` toward `b` the short way round, in degrees within [-180, 180]. */
export function lerpAngle(a: number, b: number, t: number): number {
  return normalizeAngle(a + normalizeAngle(b - a) * t);
}

function moved(ax: number, ay: number, bx: number, by: number, max: number): boolean {
  return Math.hypot(bx - ax, by - ay) > max;
}

function lerpBall(a: BallState, b: BallState, t: number): BallState {
  if (moved(a.x, a.y, b.x, b.y, MAX_BALL_STEP)) {
    return a;
  }
  const out: { -readonly [K in keyof BallState]: BallState[K] } = {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    vx: lerp(a.vx, b.vx, t),
    vy: lerp(a.vy, b.vy, t),
  };
  if (a.z !== undefined || b.z !== undefined) {
    out.z = lerp(a.z ?? 0, b.z ?? 0, t);
  }
  if (a.vz !== undefined || b.vz !== undefined) {
    out.vz = lerp(a.vz ?? 0, b.vz ?? 0, t);
  }
  return out;
}

function lerpPlayer(a: PlayerState, b: PlayerState | undefined, t: number): PlayerState {
  if (
    !b ||
    !isAlive(a) ||
    !isAlive(b) ||
    a.unum !== b.unum ||
    a.side !== b.side ||
    moved(a.x, a.y, b.x, b.y, MAX_PLAYER_STEP)
  ) {
    return a;
  }
  return {
    ...a,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    vx: lerp(a.vx, b.vx, t),
    vy: lerp(a.vy, b.vy, t),
    body: lerpAngle(a.body, b.body, t),
    // Relative to the body, within the neck's range: no wrap around.
    neck: lerp(a.neck, b.neck, t),
  };
}

/**
 * The state `alpha` (0-1) of the way from `a` to `b`. Everything else (the
 * play mode, the scores, the states) is `a`'s.
 */
export function interpolateFrame(a: Frame, b: Frame | undefined, alpha: number): Frame {
  if (!b || alpha <= 0 || a.mode !== b.mode) {
    return a;
  }
  const t = Math.min(1, alpha);
  return {
    ...a,
    ball: lerpBall(a.ball, b.ball, t),
    players: a.players.map((p, i) => lerpPlayer(p, b.players[i], t)),
  };
}

// The selected player's camera of the 3D view, in styles to compare
// (DEVELOPMENT_PLAN.md, Phase 6): where it stands, which direction it
// follows, how it turns and how wide it sees. Every combination can be
// chosen. The defaults are the first, plain camera: the eyes, following the
// face (body + neck) at once, as wide as the view.
//
// A player turns its neck up to 180 degrees a cycle to look around, so the
// plain camera may swing 1800 degrees a second; `smooth` turns toward the
// direction with a time constant and an upper limit of the angular speed.
//
// No three.js here (world coordinates as in scene-math.ts: X = field x,
// Z = field y, Y up), so that the settings and the tests can use it.
import type { PlayerState } from '../../core/frame';
import { DEG2RAD, normalizeAngle, RAD2DEG } from '../../core/geometry';
import type { CameraPose } from './cameras';
import { MAX_PLAYER_STEP } from './interpolate';

export const PLAYER_CAMERA_POSITIONS = ['eye', 'shoulder'] as const;
export const PLAYER_CAMERA_DIRECTIONS = ['head', 'body', 'middle'] as const;
export const PLAYER_CAMERA_MOTIONS = ['instant', 'smooth'] as const;
export const PLAYER_CAMERA_FOVS = ['view', 'eased', 'fixed'] as const;
/** What the player camera draws: everything, the view cone, or by the server's rules (sight.ts). */
export const PLAYER_SIGHTS = ['all', 'view', 'server'] as const;

export type PlayerCameraPosition = (typeof PLAYER_CAMERA_POSITIONS)[number];
export type PlayerCameraDirection = (typeof PLAYER_CAMERA_DIRECTIONS)[number];
export type PlayerCameraMotion = (typeof PLAYER_CAMERA_MOTIONS)[number];
export type PlayerCameraFov = (typeof PLAYER_CAMERA_FOVS)[number];
export type PlayerSight = (typeof PLAYER_SIGHTS)[number];

export interface PlayerCameraOptions {
  /** `eye`: at the eyes; `shoulder`: behind and above the player. */
  readonly position: PlayerCameraPosition;
  /** `head`: body + neck; `body`; `middle`: body + neck / 2. */
  readonly direction: PlayerCameraDirection;
  /** `instant`: the direction at once; `smooth`: limited as below. */
  readonly motion: PlayerCameraMotion;
  /** `view`: the view width at once; `eased`: toward it; `fixed`: `fixedFov`. */
  readonly fov: PlayerCameraFov;
  readonly sight: PlayerSight;
  /** Seconds, for `smooth` and `eased`. */
  readonly timeConstant: number;
  /** Degrees per second, for `smooth`. */
  readonly maxTurn: number;
  /** The horizontal field of view of `fixed`, in degrees. */
  readonly fixedFov: number;
}

export const DEFAULT_PLAYER_CAMERA: Readonly<PlayerCameraOptions> = Object.freeze({
  position: 'eye',
  direction: 'head',
  motion: 'instant',
  fov: 'view',
  sight: 'all',
  timeConstant: 0.5,
  maxTurn: 90,
  fixedFov: 90,
});

/** The eye height of the player camera. */
export const EYE_HEIGHT = 1.65;

/** Over the shoulder: this far behind the player and this high, looking at a point ahead. */
export const SHOULDER = Object.freeze({ behind: 6, height: 3, ahead: 15, targetHeight: 1 });

/** The direction (unless settled) counts as reached within this many degrees. */
const SETTLED_DEGREES = 0.05;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The direction the camera follows, in degrees. */
export function referenceDirection(p: PlayerState, d: PlayerCameraDirection): number {
  switch (d) {
    case 'body':
      return p.body;
    case 'middle':
      return p.body + p.neck / 2;
    default:
      return p.body + p.neck;
  }
}

/**
 * The view width as a horizontal field of view, in degrees: 60, 120 or 180
 * (90 if unknown), at most 120, which would distort too much.
 */
export const viewFov = (viewWidth: number) => clamp(viewWidth || 90, 40, 120);

/**
 * One step from `from` toward `to` (degrees), the short way round: a time
 * constant of `timeConstant` seconds (0: at once), but never faster than
 * `maxTurn` degrees per second.
 */
export function turnToward(
  from: number,
  to: number,
  dt: number,
  timeConstant: number,
  maxTurn: number,
): number {
  const diff = normalizeAngle(to - from);
  const t = Math.max(0, dt);
  const k = timeConstant > 0 ? 1 - Math.exp(-t / timeConstant) : 1;
  const cap = maxTurn * t;
  return normalizeAngle(from + clamp(diff * k, -cap, cap));
}

/** One step from `from` toward `to` with a time constant in seconds (0: at once). */
export function easeToward(from: number, to: number, dt: number, timeConstant: number): number {
  const k = timeConstant > 0 ? 1 - Math.exp(-Math.max(0, dt) / timeConstant) : 1;
  return from + (to - from) * k;
}

/**
 * The pose of the player camera at the player's place, looking in
 * `direction` degrees, `fov` degrees wide.
 */
export function playerCameraPose(
  at: { readonly x: number; readonly y: number },
  position: PlayerCameraPosition,
  direction: number,
  fov: number,
  aspect: number,
): CameraPose {
  const c = Math.cos(direction * DEG2RAD);
  const s = Math.sin(direction * DEG2RAD);
  const half = (fov / 2) * DEG2RAD;
  const vertical = 2 * Math.atan(Math.tan(half) / Math.max(0.1, aspect)) * RAD2DEG;
  if (position === 'shoulder') {
    const { behind, height, ahead, targetHeight } = SHOULDER;
    return {
      position: { x: at.x - behind * c, y: height, z: at.y - behind * s },
      target: { x: at.x + ahead * c, y: targetHeight, z: at.y + ahead * s },
      fov: vertical,
    };
  }
  return {
    position: { x: at.x, y: EYE_HEIGHT, z: at.y },
    target: { x: at.x + 10 * c, y: 1.0, z: at.y + 10 * s },
    fov: vertical,
  };
}

/**
 * The player camera's direction and field of view, kept from frame to frame
 * so that `smooth` and `eased` can follow. It starts again at once (no
 * smoothing) after `reset()`, for another player, or when the player jumped
 * farther than it can move in a cycle.
 */
export class PlayerCamera {
  private direction: number | null = null;
  private fov = 90;
  private who = '';
  private x = 0;
  private y = 0;

  reset(): void {
    this.direction = null;
  }

  /** The pose for this frame; `settled` when it no longer moves by itself. */
  update(
    p: PlayerState,
    aspect: number,
    o: PlayerCameraOptions,
    dt: number,
  ): { pose: CameraPose; settled: boolean } {
    const goal = referenceDirection(p, o.direction);
    const goalFov = o.fov === 'fixed' ? o.fixedFov : viewFov(p.viewWidth);
    const who = `${p.side}:${p.unum}`;
    const jumped = Math.hypot(p.x - this.x, p.y - this.y) > MAX_PLAYER_STEP;
    if (this.direction === null || who !== this.who || jumped) {
      this.direction = goal;
      this.fov = goalFov;
    } else {
      this.direction =
        o.motion === 'smooth'
          ? turnToward(this.direction, goal, dt, o.timeConstant, o.maxTurn)
          : goal;
      this.fov = o.fov === 'eased' ? easeToward(this.fov, goalFov, dt, o.timeConstant) : goalFov;
    }
    this.who = who;
    this.x = p.x;
    this.y = p.y;
    const settled =
      Math.abs(normalizeAngle(goal - this.direction)) < SETTLED_DEGREES &&
      Math.abs(goalFov - this.fov) < SETTLED_DEGREES;
    if (settled) {
      this.direction = goal;
      this.fov = goalFov;
    }
    return {
      pose: playerCameraPose(p, o.position, this.direction, this.fov, aspect),
      settled,
    };
  }

  /** The direction (degrees) and the horizontal field of view now, for the tests. */
  get state(): { direction: number | null; fov: number } {
    return { direction: this.direction, fov: this.fov };
  }
}

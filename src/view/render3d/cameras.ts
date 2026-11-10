// The cameras of the 3D view, without three.js (world coordinates as in
// scene-math.ts: X = field x, Z = field y, Y up).
//
// Cameras that follow the ball follow where it is on the ground, so that a
// ball in the air (the planned 2.5D simulator) does not shake the picture.
// The selected player's camera is in player-camera.ts.
import { PITCH } from '../../core/constants';
import { DEG2RAD } from '../../core/geometry';
import { CAMERA_ELEVATION, fitCameraPosition, TEXTURE_AREA, type World } from './scene-math';

export const CAMERA_MODES = [
  'free',
  'broadcast',
  'top',
  'goal-left',
  'goal-right',
  'player',
] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export const CAMERA_LABELS: Readonly<Record<CameraMode, string>> = {
  free: 'Free',
  broadcast: 'Broadcast',
  top: 'Top',
  'goal-left': 'Behind the Left Goal',
  'goal-right': 'Behind the Right Goal',
  player: 'Selected Player',
};

export interface CameraPose {
  readonly position: World;
  readonly target: World;
  /** Vertical field of view in degrees. */
  readonly fov: number;
}

/** The field of view of the perspective cameras, except the player's. */
export const CAMERA_FOV = 35;

/** How much closer than the whole-pitch view the broadcast camera is. */
const BROADCAST_ZOOM = 0.55;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Broadcast: from beyond the near touch line, looking down at the ball's
 * ground position, which it follows along the touch line.
 */
export function broadcastPose(aspect: number, ball: { x: number; y: number }): CameraPose {
  const full = fitCameraPosition(CAMERA_FOV, aspect).position;
  const distance = Math.hypot(full.y, full.z) * BROADCAST_ZOOM;
  const e = CAMERA_ELEVATION * DEG2RAD;
  const tx = clamp(ball.x, -PITCH.length / 2 + 10, PITCH.length / 2 - 10);
  // At the ball, but not so near a touch line that the pitch leaves the view.
  const tz = clamp(ball.y, -PITCH.width / 2 + 10, PITCH.width / 2 - 10);
  return {
    position: { x: tx, y: distance * Math.sin(e), z: tz + distance * Math.cos(e) },
    target: { x: tx, y: 0, z: tz },
    fov: CAMERA_FOV,
  };
}

/** Behind a goal (-1 left, +1 right), above the crossbar, looking at the ball. */
export function goalPose(side: -1 | 1, ball: { x: number; y: number }): CameraPose {
  const x = side * (PITCH.length / 2 + 18);
  return {
    position: { x, y: 10, z: 0 },
    // Halfway between the goal and the ball, so that both stay in view.
    target: {
      x: (side * (PITCH.length / 2) + clamp(ball.x, -PITCH.length / 2, PITCH.length / 2)) / 2,
      y: 0,
      z: clamp(ball.y, -PITCH.width / 2, PITCH.width / 2) * 0.6,
    },
    fov: 45,
  };
}

/**
 * Half the width and height of the top camera's view in meters: the pitch
 * and its margin (as the 2D view fits them, key I), with 15% of the height
 * kept for the team logos and the score board.
 */
export function topHalfSize(aspect: number): { halfWidth: number; halfHeight: number } {
  const halfHeight = Math.max(TEXTURE_AREA.width / 2 / 0.85, TEXTURE_AREA.length / 2 / aspect);
  return { halfWidth: halfHeight * aspect, halfHeight };
}

/** Moves `from` toward `to`, a fraction that depends on the time step (seconds). */
export function smoothToward(from: World, to: World, dt: number, timeConstant = 0.35): World {
  const k = 1 - Math.exp(-Math.max(0, dt) / timeConstant);
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    z: from.z + (to.z - from.z) * k,
  };
}

export function distance(a: World, b: World): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function nextCameraMode(mode: CameraMode): CameraMode {
  const i = CAMERA_MODES.indexOf(mode);
  return CAMERA_MODES[(i + 1) % CAMERA_MODES.length] ?? 'free';
}

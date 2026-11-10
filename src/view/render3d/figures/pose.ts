// The pose of a human figure from what the log says of the player
// (figures.ts), without three.js so that it can be tested: the figure's
// clips walk and run, and the kick, the tackle, the catch and the pointing
// arm of the pose go over them (gltf.ts). Angles are in
// degrees: a limb's pitch swings it forward (+) or back (-), its yaw turns
// it as the field's directions do (clockwise on the 2D screen: to the
// player's right), and a bend folds the knee back or the elbow forward.
import { PlayerStateBit } from '../../../core/constants';
import type { PlayerState } from '../../../core/frame';
import { normalizeAngle, rotate, vectorAngle } from '../../../core/geometry';
import { actionFrame, actionPhase, curve, type FigureTime } from './figures';

export interface LimbPose {
  pitch: number;
  yaw: number;
  bend: number;
}

export interface Pose {
  /** How far down the hips go (m), as in a sliding tackle. */
  drop: number;
  /** The upper body forward (+) or back (-). */
  lean: number;
  /** The head's yaw from the body: the neck. */
  head: number;
  readonly legL: LimbPose;
  readonly legR: LimbPose;
  readonly armL: LimbPose;
  readonly armR: LimbPose;
  /** The action being played, if any. */
  action: 'kick' | 'tackle' | 'catch' | null;
}

/** Meters of a stride (both feet) at a walk and at full speed. */
const STRIDE_WALK = 1.2;
const STRIDE_RUN = 2.6;
/** The speed (m/s) at which the swing is full. */
const FULL_SPEED = 7;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The player's speed in m/s. */
export function speedOf(p: PlayerState, step: number): number {
  return Math.hypot(p.vx, p.vy) / Math.max(1e-3, step);
}

/**
 * The gait's phase (radians) after `dt` seconds: on by the distance walked
 * over the stride, back when the player goes backward.
 */
export function advanceGait(phase: number, p: PlayerState, time: FigureTime): number {
  const v = speedOf(p, time.step);
  if (v < 0.05 || time.dt <= 0) {
    return phase;
  }
  const stride = lerp(STRIDE_WALK, STRIDE_RUN, clamp(v / FULL_SPEED, 0, 1));
  const backward = Math.abs(normalizeAngle(vectorAngle(p.vx, p.vy) - p.body)) > 110;
  return phase + (backward ? -1 : 1) * ((v * time.dt) / stride) * 2 * Math.PI;
}

/** Walking and running: the legs and arms swing with the gait, more the faster. */
export function locomotion(p: PlayerState, phase: number, step: number): Pose {
  const amp = clamp(speedOf(p, step) / FULL_SPEED, 0, 1);
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const pose: Pose = {
    drop: 0.04 * amp,
    lean: 12 * amp,
    head: p.neck,
    legL: { pitch: 38 * amp * s, yaw: 0, bend: 8 * amp + 60 * amp * Math.max(0, c) },
    legR: { pitch: -38 * amp * s, yaw: 0, bend: 8 * amp + 60 * amp * Math.max(0, -c) },
    armL: { pitch: -30 * amp * s, yaw: 0, bend: 15 + 60 * amp },
    armR: { pitch: 30 * amp * s, yaw: 0, bend: 15 + 60 * amp },
    action: null,
  };
  return pose;
}

/** The ball's direction from the body at the frame of an action, and whether it is on the right. */
function ballFrom(time: FigureTime, phase: number, index: number): { dir: number; right: boolean } {
  const f = actionFrame(time, phase);
  const me = f?.players[index];
  if (!f || !me) {
    return { dir: 0, right: true };
  }
  const rel = rotate({ x: f.ball.x - me.x, y: f.ball.y - me.y }, -me.body);
  return { dir: vectorAngle(rel.x, rel.y), right: rel.y >= 0 };
}

/**
 * The whole pose: locomotion, the head by the neck, then over it the
 * actions of the frames around (the kick, the tackle, the goalie's catch)
 * and the arm pointing (pointto).
 */
export function poseOf(p: PlayerState, index: number, phase: number, time: FigureTime): Pose {
  const pose = locomotion(p, phase, time.step);
  const B = PlayerStateBit;

  const tackle = actionPhase(time, index, B.Tackle | B.TackleFault, time.tackleCycles + 2);
  const kick = actionPhase(time, index, B.Kick | B.KickFault, 2);
  const isCatch = actionPhase(time, index, B.Catch | B.CatchFault, time.catchCycles + 1);

  if (tackle !== null) {
    // Sliding with the right leg ahead, held while the server holds the player.
    const w = curve(
      [
        [-0.6, 0],
        [0, 1],
        [time.tackleCycles, 1],
        [time.tackleCycles + 2, 0],
      ],
      tackle,
    );
    pose.drop = lerp(pose.drop, 0.5, w);
    pose.lean = lerp(pose.lean, -35, w);
    blend(pose.legR, { pitch: 80, yaw: 0, bend: 5 }, w);
    blend(pose.legL, { pitch: 25, yaw: 0, bend: 110 }, w);
    blend(pose.armL, { pitch: -40, yaw: -20, bend: 20 }, w);
    blend(pose.armR, { pitch: -40, yaw: 20, bend: 20 }, w);
    pose.action = w > 0 ? 'tackle' : null;
  } else if (kick !== null && kick < 1.5) {
    // The leg on the ball's side swings back, through the ball and on.
    const ball = ballFrom(time, kick, index);
    const leg = ball.right ? pose.legR : pose.legL;
    const other = ball.right ? pose.legL : pose.legR;
    const pitch = curve(
      [
        [-1, 0],
        [-0.45, -40],
        [0, 30],
        [0.6, 65],
        [1.5, 0],
      ],
      kick,
    );
    const bend = curve(
      [
        [-1, 0],
        [-0.45, 85],
        [0, 10],
        [0.6, 15],
        [1.5, 0],
      ],
      kick,
    );
    const w = curve(
      [
        [-1, 0],
        [-0.7, 1],
        [1, 1],
        [1.5, 0],
      ],
      kick,
    );
    blend(leg, { pitch, yaw: clamp(ball.dir, -45, 45), bend }, w);
    blend(other, { pitch: -5, yaw: 0, bend: 15 }, w);
    const arm = ball.right ? pose.armL : pose.armR;
    blend(arm, { pitch: 35, yaw: ball.right ? -30 : 30, bend: 20 }, w);
    pose.action = 'kick';
  }
  if (isCatch !== null) {
    // Both hands up toward the ball, held while the goalie keeps it.
    const ball = ballFrom(time, isCatch, index);
    const w = curve(
      [
        [-1, 0],
        [-0.3, 1],
        [time.catchCycles, 1],
        [time.catchCycles + 1, 0],
      ],
      isCatch,
    );
    const yaw = clamp(ball.dir, -50, 50);
    blend(pose.armL, { pitch: 150, yaw, bend: 15 }, w);
    blend(pose.armR, { pitch: 150, yaw, bend: 15 }, w);
    pose.lean = lerp(pose.lean, 10, w);
    pose.action = 'catch';
  } else if (p.point && pose.action === null) {
    // Pointing with the right arm.
    const dir = normalizeAngle(vectorAngle(p.point.x - p.x, p.point.y - p.y) - p.body);
    blend(pose.armR, { pitch: 90, yaw: clamp(dir, -80, 80), bend: 0 }, 1);
  }
  return pose;
}

function blend(a: LimbPose, b: LimbPose, w: number): void {
  a.pitch = lerp(a.pitch, b.pitch, w);
  a.yaw = lerp(a.yaw, b.yaw, w);
  a.bend = lerp(a.bend, b.bend, w);
}

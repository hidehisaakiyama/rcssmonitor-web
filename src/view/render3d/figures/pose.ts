// The pose of a human figure from what the log says of the player
// (figures.ts), without three.js so that it can be tested: the figure's
// clips walk and run (as far as gaitAt says it has walked), and the kick,
// the tackle, the catch, the fall after a foul and the pointing arm of the
// pose go over them (gltf.ts). Angles are in
// degrees: a limb's pitch swings it forward (+) or back (-), its yaw turns
// it as the field's directions do (clockwise on the 2D screen: to the
// player's right), and a bend folds the knee back or the elbow forward.
import { MAX_PLAYER, PlayerStateBit } from '../../../core/constants';
import { isAlive, type PlayerState } from '../../../core/frame';
import type { GameStore } from '../../../core/game-store';
import { normalizeAngle, rotate, vectorAngle } from '../../../core/geometry';
import { actionFrame, actionRun, curve, type FigureTime } from './figures';

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
  /** The action being played, if any; fouled: down after a foul. */
  action: 'kick' | 'tackle' | 'catch' | 'fouled' | null;
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

/** Farther than this in a cycle (m) is a move, not walking. */
const TELEPORT = 2;
const PLAYERS = 2 * MAX_PLAYER;

/** How far each player has walked by each frame, by frame * PLAYERS + index. */
interface GaitTable {
  frames: number;
  /** Meters, less when going backward. */
  readonly distance: number[];
  /** Radians of the gait: the distance over the stride, which grows with the speed. */
  readonly phase: number[];
}

const gaits = new WeakMap<GameStore, GaitTable>();

/** The gait table of `store`, extended to its last frame (a live game grows). */
function gaitTable(store: GameStore, step: number): GaitTable {
  let t = gaits.get(store);
  if (!t) {
    t = { frames: 0, distance: [], phase: [] };
    gaits.set(store, t);
  }
  for (let i = t.frames; i < store.frameCount; ++i) {
    const before = i > 0 ? store.frame(i - 1) : undefined;
    const now = store.frame(i);
    for (let k = 0; k < PLAYERS; ++k) {
      // Out of step with each other from the start.
      let distance = i > 0 ? (t.distance[(i - 1) * PLAYERS + k] ?? 0) : k * 0.37;
      let phase = i > 0 ? (t.phase[(i - 1) * PLAYERS + k] ?? 0) : k * 1.7;
      const a = before?.players[k];
      const b = now?.players[k];
      if (a && b && isAlive(a) && isAlive(b)) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 1e-4 && d < TELEPORT) {
          const back = Math.abs(normalizeAngle(vectorAngle(dx, dy) - a.body)) > 110 ? -1 : 1;
          const v = d / Math.max(1e-3, step);
          const stride = lerp(STRIDE_WALK, STRIDE_RUN, clamp(v / FULL_SPEED, 0, 1));
          distance += back * d;
          phase += ((back * d) / stride) * 2 * Math.PI;
        }
      }
      t.distance[i * PLAYERS + k] = distance;
      t.phase[i * PLAYERS + k] = phase;
    }
  }
  t.frames = store.frameCount;
  return t;
}

/**
 * How far player `index` has walked at the time drawn (m, less when going
 * backward) and the gait's phase (radians), from the log: the same
 * whenever the frame is drawn, and back when stepping back.
 */
export function gaitAt(time: FigureTime, index: number): { distance: number; phase: number } {
  const store = time.store;
  if (!store || store.frameCount === 0) {
    return { distance: 0, phase: 0 };
  }
  const t = gaitTable(store, time.step);
  const i = clamp(time.frameIndex, 0, store.frameCount - 1);
  const j = Math.min(i + 1, store.frameCount - 1);
  const at = (a: readonly number[], frame: number) => a[frame * PLAYERS + index] ?? 0;
  const between = (a: readonly number[]) => at(a, i) + (at(a, j) - at(a, i)) * time.alpha;
  return { distance: between(t.distance), phase: between(t.phase) };
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

  const tackle = actionRun(time, index, B.Tackle | B.TackleFault, 2);
  const fouled = actionRun(time, index, B.FoulCharged, 2);
  const kick = actionRun(time, index, B.Kick | B.KickFault, 2)?.phase ?? null;
  const isCatch = actionRun(time, index, B.Catch | B.CatchFault, time.catchCycles + 1);

  if (fouled !== null) {
    // Down after a foul: sitting on the ground, leaning back on the hands,
    // while the server holds the player (the foul charged bit), then up.
    // Falling as the tackler slides in, down at the frame of the foul.
    const w = curve(
      [
        [-0.6, 0],
        [0, 1],
        [fouled.last + 0.5, 1],
        [fouled.last + 1.8, 0],
      ],
      fouled.phase,
    );
    pose.drop = lerp(pose.drop, 0.95, w);
    pose.lean = lerp(pose.lean, -70, w);
    blend(pose.legL, { pitch: 80, yaw: -8, bend: 25 }, w);
    blend(pose.legR, { pitch: 75, yaw: 8, bend: 35 }, w);
    blend(pose.armL, { pitch: -50, yaw: -25, bend: 10 }, w);
    blend(pose.armR, { pitch: -50, yaw: 25, bend: 10 }, w);
    pose.action = w > 0 ? 'fouled' : null;
  } else if (tackle !== null) {
    // Sliding with the right leg ahead, held while the server holds the
    // player (its bits last): tackle_cycles, but no cycle after a foul.
    const w = curve(
      [
        [-0.6, 0],
        [0, 1],
        [tackle.last + 0.3, 1],
        [tackle.last + 1.5, 0],
      ],
      tackle.phase,
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
  if (isCatch !== null && pose.action !== 'fouled') {
    // Both hands up toward the ball, held while the goalie keeps it.
    const ball = ballFrom(time, isCatch.phase, index);
    const w = curve(
      [
        [-1, 0],
        [-0.3, 1],
        [time.catchCycles, 1],
        [time.catchCycles + 1, 0],
      ],
      isCatch.phase,
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

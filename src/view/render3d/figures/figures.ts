// The players as human figures in the 3D view (DEVELOPMENT_PLAN.md,
// Phase 6), set by player_model_3d: the cylinders and spheres of
// render3d.ts (simple), or Quaternius' rigged Mannequin with its animations
// (figure, gltf.ts). Of the prototypes compared, the user chose this one.
//
// What the figures do comes from the log alone, the frame drawn and the
// fraction to the next one, so that a paused, stepped or rewound view shows
// the same pose as when it plays (pose.ts):
// - walking and running by the distance walked up to the frame (gaitAt),
//   backward when going back, and turning the head by the neck;
// - the kick, the tackle, the catch and being fouled from the runs of
//   state bits around the frame (actionRun): rcssserver keeps the tackle's
//   bits while it holds the player, which it does not after a foul, and
//   the foul charged bit while the fouled player is held.
// So the animations go with the game's time: faster with fast forward,
// still while paused, backward when stepping back.
import type { Color, Object3D } from 'three';
import type { Frame, PlayerState } from '../../../core/frame';
import type { GameStore } from '../../../core/game-store';

export const PLAYER_MODELS = ['simple', 'figure'] as const;
export type PlayerModel = (typeof PLAYER_MODELS)[number];

/** A player to draw as a figure. */
export interface FigureInput {
  /** Its index in the frame's players (0-21). */
  readonly index: number;
  /** Where and how it is drawn (interpolated). */
  readonly player: PlayerState;
  /** The jersey: the team or state color, grayed by the player camera's sight. */
  readonly color: Color;
}

/** The game's time line, for the actions and the animations. */
export interface FigureTime {
  readonly store: GameStore | null;
  /** The frame drawn, the next one and the fraction of the way to it. */
  readonly frameIndex: number;
  readonly next: Frame | undefined;
  readonly alpha: number;
  /** Seconds per cycle (simulator_step). */
  readonly step: number;
  /** Cycles a catch holds the ball (catch_ban_cycle): the arms stay up. */
  readonly catchCycles: number;
}

export interface Figures {
  readonly group: Object3D;
  /** Draws these players, hides the others. */
  update(players: readonly FigureInput[], time: FigureTime): void;
  /** What the end-to-end tests and the comparison read. */
  inspect(): FigureState;
  dispose(): void;
}

export interface FigureState {
  readonly model: PlayerModel;
  /** Whether the model is ready (the glTF loads first). */
  readonly ready: boolean;
  readonly drawn: number;
  /** The actions being played, by kind. */
  readonly kicks: number;
  readonly tackles: number;
  readonly catches: number;
  /** The players down after a foul. */
  readonly fouled: number;
  /** Where each player's left knee is (world, by player index; null: not a figure), to compare poses. */
  readonly knees: readonly ({ x: number; y: number; z: number } | null)[];
  /** How each player's head is turned (world quaternion x, y, z, w; null: not a figure). */
  readonly heads: readonly (readonly number[] | null)[];
}

/** Frames a run of a state bit is looked through at most, longer than the server holds any. */
const MAX_RUN = 50;

/** Where an action marked by a run of frames with a state bit stands. */
export interface ActionRun {
  /**
   * Cycles from the run's first frame, plus the fraction to the next frame:
   * in [-1, 0) while the drawn frame goes to it (the wind-up).
   */
  readonly phase: number;
  /** How many cycles after its first frame the bit lasts (0: that frame only). */
  readonly last: number;
}

/**
 * The run of frames where player `index` has `bit` (any of its bits), around
 * the frame drawn: the one it is in, the one the next frame starts, or the
 * latest that ended within `within` cycles before. Null without one.
 */
export function actionRun(
  time: FigureTime,
  index: number,
  bit: number,
  within: number,
): ActionRun | null {
  const store = time.store;
  if (!store) {
    return null;
  }
  const has = (i: number) =>
    i >= 0 && i < store.frameCount && ((store.frame(i)?.players[index]?.state ?? 0) & bit) !== 0;
  const f = time.frameIndex;
  let end: number | null = has(f) ? f : has(f + 1) ? f + 1 : null;
  for (let k = 1; end === null && k <= within; ++k) {
    if (has(f - k)) {
      end = f - k;
    }
  }
  if (end === null) {
    return null;
  }
  let first = end;
  while (end - first < MAX_RUN && has(first - 1)) {
    --first;
  }
  let last = end;
  while (last - first < MAX_RUN && has(last + 1)) {
    ++last;
  }
  return { phase: f - first + time.alpha, last: last - first };
}

/** The frame where an action of `phase` (actionPhase) happened. */
export function actionFrame(time: FigureTime, phase: number): Frame | undefined {
  const k = Math.floor(phase);
  return k < 0 ? time.next : time.store?.frame(time.frameIndex - k);
}

/** Linear through the points [x, y] (x ascending), flat beyond the ends. */
export function curve(points: readonly (readonly [number, number])[], x: number): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) {
    return 0;
  }
  if (x <= first[0]) {
    return first[1];
  }
  for (let i = 1; i < points.length; ++i) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b && x <= b[0]) {
      const t = (x - a[0]) / (b[0] - a[0] || 1);
      // Eased between the points.
      const s = t * t * (3 - 2 * t);
      return a[1] + (b[1] - a[1]) * s;
    }
  }
  return last[1];
}

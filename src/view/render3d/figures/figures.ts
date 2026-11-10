// The players as human figures in the 3D view (DEVELOPMENT_PLAN.md,
// Phase 6), set by player_model_3d: the cylinders and spheres of
// render3d.ts (simple), or Quaternius' rigged Mannequin with its animations
// (figure, gltf.ts). Of the prototypes compared, the user chose this one.
//
// What the figures do comes from the log:
// - walking and running by the speed, and turning the head by the neck;
// - the kick, the tackle and the catch from the state bits of the frames
//   around the one drawn (actionPhase), so that a paused, stepped or
//   rewound view shows the same pose as when it plays (pose.ts).
// The animations go by the game's time (frames and the fraction between
// them), so they speed up with fast forward and stop with the pause.
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
  /** Seconds of the game since the last draw: 0 when paused or after a jump. */
  readonly dt: number;
  /** Seconds per cycle (simulator_step). */
  readonly step: number;
  /** Cycles a tackle holds the player (tackle_cycles), and a catch (catch_ban_cycle). */
  readonly tackleCycles: number;
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
}

/**
 * Where an action marked by a state bit stands for player `index`, in
 * cycles from the frame where it happened: in [-1, 0) while the drawn frame
 * goes to the next one, which has the bit (the wind-up); else the cycles
 * since the latest frame with it, within `within` cycles back, plus the
 * fraction to the next frame. Null without one.
 */
export function actionPhase(
  time: FigureTime,
  index: number,
  bit: number,
  within: number,
): number | null {
  const has = (f: Frame | undefined) => ((f?.players[index]?.state ?? 0) & bit) !== 0;
  const store = time.store;
  if (!store) {
    return null;
  }
  if (has(store.frame(time.frameIndex))) {
    return time.alpha;
  }
  if (has(time.next)) {
    return time.alpha - 1;
  }
  for (let k = 1; k <= within; ++k) {
    if (has(store.frame(time.frameIndex - k))) {
      return k + time.alpha;
    }
  }
  return null;
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

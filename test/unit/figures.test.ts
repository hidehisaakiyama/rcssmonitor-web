import { describe, expect, it } from 'vitest';
import { PlayerStateBit } from '../../src/core/constants';
import { disabledPlayer, type Frame, type PlayerState } from '../../src/core/frame';
import type { GameStore } from '../../src/core/game-store';
import { actionRun, curve, type FigureTime } from '../../src/view/render3d/figures/figures';
import { gaitAt, poseOf } from '../../src/view/render3d/figures/pose';

const B = PlayerStateBit;
const player = (state: number, extra: Partial<PlayerState> = {}): PlayerState => ({
  ...disabledPlayer(0),
  state: B.Stand | state,
  stamina: 8000,
  effort: 1,
  recovery: 1,
  viewWidth: 90,
  ...extra,
});
const frame = (p: PlayerState, ball = { x: 0.5, y: 0.3 }): Frame =>
  ({
    time: 0,
    stime: 0,
    mode: 2,
    ball: { ...ball, vx: 0, vy: 0 },
    players: [p],
    teams: [
      { name: '', score: 0, penScore: 0, penMiss: 0 },
      { name: '', score: 0, penScore: 0, penMiss: 0 },
    ],
  }) as unknown as Frame;

/** A store of `frames`, kept for each list (the gait table is the store's). */
const stores = new WeakMap<Frame[], GameStore>();
function storeOf(frames: Frame[]): GameStore {
  let store = stores.get(frames);
  if (!store) {
    store = { frame: (i: number) => frames[i], frameCount: frames.length } as unknown as GameStore;
    stores.set(frames, store);
  }
  return store;
}

/** The time at frame `index` of `frames`, `alpha` of the way to the next. */
function at(frames: Frame[], index: number, alpha: number): FigureTime {
  return {
    store: storeOf(frames),
    frameIndex: index,
    next: frames[index + 1],
    alpha,
    step: 0.1,
    catchCycles: 5,
  };
}

/** Frames of a player with `state(i)` in frame i, moving as `place(i)` says. */
const run = (
  n: number,
  state: (i: number) => number,
  place: (i: number) => Partial<PlayerState> = () => ({}),
) => Array.from({ length: n }, (_, i) => frame(player(state(i), place(i))));

describe('the figures', () => {
  // A kick in frame 3 of 0-9.
  const frames = Array.from({ length: 10 }, (_, i) => frame(player(i === 3 ? B.Kick : 0)));

  it('find an action around the frame drawn, from the log alone', () => {
    const phase = (t: FigureTime) => actionRun(t, 0, B.Kick, 2)?.phase ?? null;
    expect(phase(at(frames, 2, 0.5))).toBe(-0.5); // the wind-up
    expect(phase(at(frames, 3, 0))).toBe(0); // paused on it: the moment
    expect(phase(at(frames, 4, 0.25))).toBe(1.25);
    expect(phase(at(frames, 6, 0))).toBeNull(); // long past
    expect(phase(at(frames, 1, 0.5))).toBeNull(); // not yet
    // A run of frames with the bit: from its first, as long as it lasts.
    const held = run(20, (i) => (i >= 4 && i <= 13 ? B.Tackle : 0));
    expect(actionRun(at(held, 9, 0.5), 0, B.Tackle, 2)).toEqual({ phase: 5.5, last: 9 });
    expect(actionRun(at(held, 15, 0), 0, B.Tackle, 2)).toEqual({ phase: 11, last: 9 });
    expect(actionRun(at(held, 16, 0), 0, B.Tackle, 2)).toBeNull();
  });

  it('kick with the leg on the ball side, and hold a tackle while the server does', () => {
    const p = player(B.Kick, { body: 0 });
    // The ball on the right (+y): the right leg through the ball at the moment.
    const kick = poseOf(p, 0, 0, at(frames, 3, 0));
    expect(kick.action).toBe('kick');
    expect(kick.legR.pitch).toBeCloseTo(30);
    expect(Math.abs(kick.legL.pitch)).toBeLessThan(10);
    const left = [frame(player(B.Kick), { x: 0.5, y: -0.3 })];
    expect(poseOf(p, 0, 0, at(left, 0, 0)).legL.pitch).toBeCloseTo(30);

    // rcssserver keeps the tackle's bit while it holds the player
    // (tackle_cycles, 10): down and sliding through them, then up.
    const tackles = run(20, (i) => (i >= 2 && i <= 11 ? B.Tackle : 0));
    for (const k of [2, 7, 11]) {
      const pose = poseOf(player(0), 0, 0, at(tackles, k, 0));
      expect(pose.action).toBe('tackle');
      expect(pose.drop).toBeCloseTo(0.5);
    }
    expect(poseOf(player(0), 0, 0, at(tackles, 14, 0)).action).toBeNull();
    // After a foul it does not hold the tackler: the bit is in one frame,
    // and the tackler gets up at once as it goes on.
    const foul = run(20, (i) => (i === 2 ? B.Tackle : 0));
    expect(poseOf(player(0), 0, 0, at(foul, 2, 0)).drop).toBeCloseTo(0.5);
    expect(poseOf(player(0), 0, 0, at(foul, 3, 0)).drop).toBeLessThan(0.4);
    expect(poseOf(player(0), 0, 0, at(foul, 4, 0)).action).toBeNull();
  });

  it('put the fouled player down while it is held (foul_cycles), then up', () => {
    const fouled = run(20, (i) => (i >= 5 && i <= 9 ? B.FoulCharged : 0));
    for (const k of [5, 7, 9]) {
      const pose = poseOf(player(0), 0, 0, at(fouled, k, 0));
      expect(pose.action).toBe('fouled');
      expect(pose.drop).toBeCloseTo(0.95); // sitting on the ground
      expect(pose.legL.pitch).toBeCloseTo(80); // the legs ahead
      expect(pose.armL.pitch).toBeLessThan(0); // the hands behind
    }
    expect(poseOf(player(0), 0, 0, at(fouled, 4, 0.5)).action).toBe('fouled'); // falling
    expect(poseOf(player(0), 0, 0, at(fouled, 12, 0)).action).toBeNull();
  });

  it('raise both hands for the goalie catch, and point with the right arm', () => {
    const catches = [frame(player(B.Catch | B.Goalie), { x: 1, y: 0 })];
    const pose = poseOf(player(B.Goalie), 0, 0, at(catches, 0, 0));
    expect(pose.action).toBe('catch');
    expect(pose.armL.pitch).toBeCloseTo(150);
    const pointing = poseOf(player(0, { point: { x: 0, y: 10 } }), 0, 0, at(frames, 7, 0));
    expect(pointing.armR.pitch).toBeCloseTo(90);
    expect(pointing.armR.yaw).toBeCloseTo(80); // to the right, at most 80
  });

  it('walk as far as the log says, the same however the frame is reached', () => {
    // 0.5 m a cycle along +x, then 0.5 m back facing the same way, then a move.
    const x = (i: number) => (i <= 10 ? i * 0.5 : i <= 15 ? 5 - (i - 10) * 0.5 : 40);
    const walks = run(
      20,
      () => 0,
      (i) => ({ x: x(i), body: 0 }),
    );
    const g = (k: number, alpha = 0) => gaitAt(at(walks, k, alpha), 0);
    expect(g(0).distance).toBe(0);
    expect(g(10).distance).toBeCloseTo(5);
    expect(g(4, 0.5).distance).toBeCloseTo(2.25); // between the frames
    expect(g(15).distance).toBeCloseTo(2.5); // backward: back on the clips
    expect(g(16).distance).toBeCloseTo(2.5); // the move is not walked
    expect(g(10).phase).toBeGreaterThan(g(5).phase);
    expect(g(15).phase).toBeLessThan(g(10).phase);
    // Stepping back and forth, or jumping, gives the same.
    const again = [g(12), g(3), g(12)];
    expect(again[0]).toEqual(again[2]);
    // Players are out of step with each other.
    expect(gaitAt(at(walks, 0, 0), 1).phase).not.toBe(g(0).phase);
    expect(
      curve(
        [
          [0, 0],
          [1, 10],
        ],
        0.5,
      ),
    ).toBeCloseTo(5);
    expect(
      curve(
        [
          [0, 0],
          [1, 10],
        ],
        2,
      ),
    ).toBe(10);
  });
});

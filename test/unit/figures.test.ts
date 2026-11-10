import { describe, expect, it } from 'vitest';
import { PlayerStateBit } from '../../src/core/constants';
import { disabledPlayer, type Frame, type PlayerState } from '../../src/core/frame';
import type { GameStore } from '../../src/core/game-store';
import { actionPhase, curve, type FigureTime } from '../../src/view/render3d/figures/figures';
import { advanceGait, poseOf } from '../../src/view/render3d/figures/pose';

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

/** The time at frame `index` of `frames`, `alpha` of the way to the next. */
function at(frames: Frame[], index: number, alpha: number, dt = 0): FigureTime {
  const store = { frame: (i: number) => frames[i] } as unknown as GameStore;
  return {
    store,
    frameIndex: index,
    next: frames[index + 1],
    alpha,
    dt,
    step: 0.1,
    tackleCycles: 10,
    catchCycles: 5,
  };
}

describe('the figures', () => {
  // A kick in frame 3 of 0-9.
  const frames = Array.from({ length: 10 }, (_, i) => frame(player(i === 3 ? B.Kick : 0)));

  it('find an action around the frame drawn, from the log alone', () => {
    expect(actionPhase(at(frames, 2, 0.5), 0, B.Kick, 2)).toBe(-0.5); // the wind-up
    expect(actionPhase(at(frames, 3, 0), 0, B.Kick, 2)).toBe(0); // paused on it: the moment
    expect(actionPhase(at(frames, 4, 0.25), 0, B.Kick, 2)).toBe(1.25);
    expect(actionPhase(at(frames, 6, 0), 0, B.Kick, 2)).toBeNull(); // long past
    expect(actionPhase(at(frames, 1, 0.5), 0, B.Kick, 2)).toBeNull(); // not yet
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

    const tackles = Array.from({ length: 20 }, (_, i) => frame(player(i === 2 ? B.Tackle : 0)));
    for (const k of [3, 8, 12]) {
      // Down and sliding until tackle_cycles (10) after it.
      const pose = poseOf(player(0), 0, 0, at(tackles, k, 0));
      expect(pose.action).toBe('tackle');
      expect(pose.drop).toBeCloseTo(0.5);
    }
    expect(poseOf(player(0), 0, 0, at(tackles, 15, 0)).action).toBeNull();
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

  it('step on with the distance, backward when going back', () => {
    const t = at(frames, 7, 0, 0.1);
    const forward = player(0, { body: 0, vx: 0.5, vy: 0 });
    expect(advanceGait(0, forward, t)).toBeGreaterThan(0);
    expect(advanceGait(0, player(0, { body: 180, vx: 0.5, vy: 0 }), t)).toBeLessThan(0);
    expect(advanceGait(1, player(0), t)).toBe(1); // standing
    expect(advanceGait(1, forward, { ...t, dt: 0 })).toBe(1); // paused
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

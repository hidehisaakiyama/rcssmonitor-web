import { describe, expect, it } from 'vitest';
import { disabledPlayer } from '../../src/core/frame';
import { GameStore } from '../../src/core/game-store';
import { Playback } from '../../src/playback/playback';
import { loadFixture } from './helpers';

function storeWith(count: number): GameStore {
  const store = new GameStore();
  for (let t = 1; t <= count; ++t) {
    store.apply({
      type: 'show',
      show: {
        time: t,
        stime: 0,
        ball: { x: 0, y: 0, vx: 0, vy: 0 },
        players: Array.from({ length: 22 }, (_, i) => disabledPlayer(i)),
      },
    });
  }
  return store;
}

/** Appends a frame like the last one at another cycle, as live reception does. */
function addShow(store: GameStore, time: number): void {
  const last = store.lastFrame;
  if (!last) {
    throw new Error('empty store');
  }
  store.apply({ type: 'show', show: { ...last, time } });
}

function playing(count: number): Playback {
  const p = new Playback();
  p.setStore(storeWith(count));
  return p;
}

describe('Playback', () => {
  it('starts stopped at the first frame', () => {
    const p = playing(10);
    expect([p.index, p.playing, p.interval, p.frameCount]).toEqual([0, false, 100, 10]);
  });

  it('steps by elapsed time while playing', () => {
    const p = playing(10);
    p.play();
    p.tick(1000); // first tick only sets the clock
    expect(p.index).toBe(0);
    p.tick(1099);
    expect(p.index).toBe(0);
    p.tick(1100);
    expect(p.index).toBe(1);
    p.tick(1350);
    expect(p.index).toBe(3);
    expect(p.position().alpha).toBeCloseTo(0.5);
  });

  it('plays faster than the display with short intervals', () => {
    const p = playing(1000);
    p.play();
    for (let i = 0; i < 4; ++i) {
      p.accelerate();
    }
    expect(p.interval).toBe(6); // 100 / 2 / 2 / 2 / 2, truncated
    p.accelerate();
    expect(p.interval).toBe(5); // the minimum
    p.tick(0);
    p.tick(1000 / 60); // one display frame
    expect(p.index).toBe(3);
  });

  it('stops at the last frame, or wraps around when looping', () => {
    const p = playing(3);
    p.play();
    p.tick(0);
    p.tick(250);
    expect([p.index, p.playing]).toEqual([2, true]);
    p.tick(300); // the step past the end stops playback, as rcssmonitor's timer does
    expect([p.index, p.playing]).toEqual([2, false]);

    p.loop = true;
    p.goToFirst();
    p.play();
    p.tick(1000);
    p.tick(1200);
    p.tick(1400);
    expect([p.index, p.playing]).toEqual([1, true]); // 0 -> 1 -> 2 -> 0 -> 1
    p.stepBackward();
    p.stepBackward();
    expect(p.index).toBe(2); // wrapped backward
  });

  it('changes the speed only while playing, and play resets it', () => {
    const p = playing(10);
    p.accelerate();
    expect(p.interval).toBe(100);
    p.play();
    p.decelerate();
    expect(p.interval).toBe(200);
    for (let i = 0; i < 10; ++i) {
      p.decelerate();
    }
    expect(p.interval).toBe(5000);
    p.play(); // pressing play again restores the default speed (rcssmonitor)
    expect(p.interval).toBe(100);
  });

  it('stops on steps, first and last, but not on jumps', () => {
    const p = playing(10);
    p.play();
    p.goToIndex(5);
    expect([p.index, p.playing]).toEqual([5, true]);
    p.stepForward();
    expect([p.index, p.playing]).toEqual([6, false]);
    p.play();
    p.goToLast();
    expect([p.index, p.playing]).toEqual([9, false]);
    p.goToIndex(42); // out of range: ignored
    expect(p.index).toBe(9);
  });

  it('caps the time of one tick', () => {
    const p = playing(100);
    p.play();
    p.tick(0);
    p.tick(60_000); // the tab was hidden for a minute
    expect(p.index).toBe(2);
  });

  it('follows new frames in live mode', () => {
    const store = storeWith(3);
    const p = new Playback();
    p.setStore(store);
    p.setLive();
    expect([p.index, p.live]).toEqual([2, true]);
    addShow(store, 4);
    p.framesAdded();
    expect(p.index).toBe(3);
    p.stepBackward();
    expect(p.live).toBe(false);
    addShow(store, 5);
    p.framesAdded();
    expect(p.index).toBe(2);
  });

  it('notifies listeners', () => {
    const p = playing(10);
    let calls = 0;
    p.onChange(() => ++calls);
    p.stepForward();
    p.togglePlay();
    p.togglePlay();
    expect(calls).toBe(3);
  });
});

describe('Playback jumps on a real log', async () => {
  const { store } = await loadFixture('text-v5-sample.rcg.gz');

  it('goes to a cycle', () => {
    const p = new Playback();
    p.setStore(store);
    expect(p.goToCycle(789)).toBe(true);
    expect(store.frame(p.index)).toMatchObject({ time: 789, stime: 0 });
    expect(p.goToCycle(300)).toBe(true); // not in the fixture: the next cycle there is
    expect(store.frame(p.index)?.time).toBe(785);
    expect(p.goToCycle(9000)).toBe(false);
  });

  it('jumps 50 frames before the goal, where rcssmonitor jumps', () => {
    // The score changes at frame 248; rcssmonitor records frame 247 and
    // goes to 247 - 50.
    expect(store.scoreChanges).toEqual([248]);
    const p = new Playback();
    p.setStore(store);
    p.goToNextScore();
    expect(p.index).toBe(197);
    p.goToNextScore(); // already within 50 frames: stays
    expect(p.index).toBe(197);
    p.goToLast();
    p.goToPreviousScore();
    expect(p.index).toBe(197);
    p.goToIndex(100);
    p.goToPreviousScore(); // no goal before
    expect(p.index).toBe(100);
  });
});

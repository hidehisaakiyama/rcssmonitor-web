import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Frame } from '../../src/core/frame';
import type { GameStore } from '../../src/core/game-store';
import { applySettings, defaultTargets, resetView3d } from '../../src/options/settings';
import { BALL_AIDS, ballTrailPoints, trailRibbon } from '../../src/view/render3d/ball-aids';

/** A store whose ball is at `xs[i]` (field x) in frame i. */
const store = (xs: number[]): GameStore =>
  ({
    frameCount: xs.length,
    frame: (i: number) => ({ ball: { x: xs[i] ?? 0, y: 2, vx: 0, vy: 0 } }) as unknown as Frame,
  }) as unknown as GameStore;

describe('the trail behind the ball', () => {
  // 1 m a cycle along +x.
  const moving = store([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  it('goes back as many cycles from where the ball is drawn', () => {
    const r = 0.1;
    const p = ballTrailPoints(moving, 8, 0.5, 3, r);
    // The drawn place, frames 8, 7, 6, and the tail between 6 and 5.
    expect(p.map((q) => q.age)).toEqual([0, 0.5, 1.5, 2.5, 3]);
    expect(p.map((q) => q.x)).toEqual([8.5, 8, 7, 6, 5.5]);
    // Through the ball's center, in world coordinates (Z = field y).
    expect(p.every((q) => q.y === r && q.z === 2)).toBe(true);
    // Paused on a frame: from it.
    expect(ballTrailPoints(moving, 8, 0, 2, r).map((q) => q.age)).toEqual([0, 1, 2]);
    // Not before the first frame.
    expect(ballTrailPoints(moving, 1, 0, 5, r).map((q) => q.x)).toEqual([1, 0]);
  });

  it('breaks where the ball was placed', () => {
    const placed = store([0, 1, 2, 40, 41, 42]);
    expect(ballTrailPoints(placed, 5, 0, 10, 0.1).map((q) => q.x)).toEqual([42, 41, 40]);
    expect(ballTrailPoints(placed, 2, 0.5, 10, 0.1)[0]?.x).toBe(2); // no head toward 40
  });

  it('is a ribbon facing the camera, dense along its middle, narrower and fainter the older', () => {
    const points = ballTrailPoints(moving, 8, 0, 4, 0.1);
    const eye = { x: 8, y: 30, z: 40 };
    const ribbon = trailRibbon(
      points,
      eye,
      (age) => 1 - age / 4,
      (age) => 0.5 * (1 - age / 4),
    );
    expect(ribbon.positions).toHaveLength(points.length * 9);
    expect(ribbon.indices).toHaveLength((points.length - 1) * 12);
    points.forEach((q, i) => {
      const v = (k: number) =>
        new Vector3(
          ribbon.positions[i * 9 + k * 3],
          ribbon.positions[i * 9 + k * 3 + 1],
          ribbon.positions[i * 9 + k * 3 + 2],
        );
      const [left, middle, right] = [v(0), v(1), v(2)];
      expect(middle.toArray()).toEqual([q.x, q.y, q.z]);
      const across = left.clone().sub(right);
      expect(across.length()).toBeCloseTo(1 - q.age / 4);
      // Across the way it goes (+x) and the way to the camera.
      expect(across.x).toBeCloseTo(0);
      const toEye = new Vector3(eye.x - q.x, eye.y - q.y, eye.z - q.z);
      expect(across.dot(toEye)).toBeCloseTo(0);
      expect(ribbon.alphas.slice(i * 3, i * 3 + 3)).toEqual([0, 0.5 * (1 - q.age / 4), 0]);
    });
    // Nothing to draw from one point.
    expect(
      trailRibbon(
        points.slice(0, 1),
        eye,
        () => 1,
        () => 1,
      ).indices,
    ).toHaveLength(0);
  });
});

describe('the ring and the trail', () => {
  it('are settings of the 3D tab, on by default: 0.7 m (kickable_margin), 5 cycles', () => {
    const t = defaultTargets();
    const a = t.app;
    expect([a.ballRing3d, a.ballRingRadius3d, a.ballTrail3d, a.ballTrailCycles3d]).toEqual([
      true,
      0.7,
      true,
      5,
    ]);
    expect(BALL_AIDS.ringRadius).toBe(0.7);
    expect(
      applySettings(t, {
        ball_ring_3d: false,
        ball_ring_radius_3d: 2,
        ball_trail_3d: false,
        ball_trail_cycles_3d: 12,
      }),
    ).toHaveLength(4);
    expect([a.ballRing3d, a.ballRingRadius3d, a.ballTrail3d, a.ballTrailCycles3d]).toEqual([
      false,
      2,
      false,
      12,
    ]);
    // Out of the ranges (0.1-5 m, 1-30 cycles, whole cycles): not taken.
    expect(
      applySettings(t, {
        ball_ring_radius_3d: 9,
        ball_trail_cycles_3d: 2.5,
      }),
    ).toEqual([]);
    resetView3d(a);
    expect([a.ballRing3d, a.ballRingRadius3d, a.ballTrail3d, a.ballTrailCycles3d]).toEqual([
      true,
      0.7,
      true,
      5,
    ]);
  });
});

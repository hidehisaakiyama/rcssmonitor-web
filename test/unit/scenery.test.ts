import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PITCH } from '../../src/core/constants';
import type { Frame } from '../../src/core/frame';
import type { GameStore } from '../../src/core/game-store';
import { applySettings, defaultTargets, resetView3d } from '../../src/options/settings';
import { ballSpinAt, MAX_ROLL, pentagonCenters } from '../../src/view/render3d/ball';
import { BOARDS, TEXTURE_AREA } from '../../src/view/render3d/scene-math';
import {
  GRASS,
  grassBands,
  STAND_TOP,
  standGeometry,
  STANDS,
} from '../../src/view/render3d/scenery';

describe('the grass', () => {
  it('is mowed in stripes across the pitch, an edge on the halfway line', () => {
    const bands = grassBands();
    expect(bands[0]?.from).toBe(-TEXTURE_AREA.length / 2);
    expect(bands.at(-1)?.to).toBe(TEXTURE_AREA.length / 2);
    for (let i = 1; i < bands.length; ++i) {
      expect(bands[i]?.from).toBe(bands[i - 1]?.to);
      expect(bands[i]?.dark).not.toBe(bands[i - 1]?.dark);
    }
    expect(bands.some((b) => b.from === 0)).toBe(true);
    // 20 across the pitch.
    expect(
      bands.filter((b) => b.from >= -PITCH.length / 2 && b.to <= PITCH.length / 2),
    ).toHaveLength(20);
    expect(GRASS.width).toBeCloseTo(5.25);
  });
});

describe('the stands', () => {
  it('face the pitch and the sky, beyond the boards, along the touch lines only', () => {
    for (const side of [-1, 1] as const) {
      for (const end of [-1, 1] as const) {
        const g = standGeometry(side, end);
        const p = g.positions;
        expect(p.length % 9).toBe(0);
        for (let i = 0; i < p.length; i += 9) {
          const v = (k: number) => new Vector3(p[i + k * 3], p[i + k * 3 + 1], p[i + k * 3 + 2]);
          const [a, b, c] = [v(0), v(1), v(2)];
          const n = new Vector3(g.normals[i], g.normals[i + 1], g.normals[i + 2]);
          // Counterclockwise as seen from where they face: drawn from there only.
          const facing = b.clone().sub(a).cross(c.clone().sub(a));
          expect(facing.dot(n), `side ${side}, end ${end}, triangle ${i / 9}`).toBeGreaterThan(0);
          for (const q of [a, b, c]) {
            // Beyond the boards, on that side and half, no higher than the top row.
            expect(q.z * side).toBeGreaterThanOrEqual(PITCH.width / 2 + BOARDS.offset);
            expect(q.x * end).toBeGreaterThanOrEqual(0);
            expect(Math.abs(q.x)).toBeLessThanOrEqual(STANDS.halfLength + 1e-9);
            expect(q.y).toBeGreaterThanOrEqual(0);
            expect(q.y).toBeLessThanOrEqual(STAND_TOP + 1e-9);
          }
          // Toward the pitch (or up, or out of the stadium at the back and the end).
          if (n.y === 0 && n.x === 0) {
            const back =
              Math.abs(a.z) > PITCH.width / 2 + STANDS.front + STANDS.rows * STANDS.tread - 1e-6;
            expect(n.z).toBe(back ? side : -side);
          }
        }
      }
    }
  });
});

describe('the ball', () => {
  const frames = (xs: number[]): GameStore =>
    ({
      frameCount: xs.length,
      frame: (i: number) => ({ ball: { x: xs[i] ?? 0, y: 0, vx: 0, vy: 0 } }) as unknown as Frame,
    }) as unknown as GameStore;
  const angle = (q: Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));

  it('has the twelve pentagons of a football', () => {
    const { centers, toward } = pentagonCenters();
    expect(centers).toHaveLength(12);
    for (let i = 0; i < 12; ++i) {
      // Each toward a neighbor, 63.4 degrees off.
      expect((centers[i]?.angleTo(toward[i] ?? new Vector3()) ?? 0) * (180 / Math.PI)).toBeCloseTo(
        63.43,
        1,
      );
    }
  });

  it('rolls as far as it goes, the same however the frame is reached', () => {
    const r = 0.1;
    // 0.05 m a cycle along +x, then still, then a placement.
    const store = frames([0, 0.05, 0.1, 0.15, 0.15, 30]);
    expect(angle(ballSpinAt(store, 0, 0, r))).toBeCloseTo(0);
    expect(angle(ballSpinAt(store, 2, 0, r))).toBeCloseTo(1); // 0.1 m over 0.1 m
    expect(angle(ballSpinAt(store, 1, 0.5, r))).toBeCloseTo(0.75);
    // Along +x, it turns about -Z: its top goes forward.
    const q = ballSpinAt(store, 3, 0, r);
    const top = new Vector3(0, 1, 0).applyQuaternion(q);
    expect(top.x).toBeGreaterThan(0);
    expect(ballSpinAt(store, 4, 0, r).equals(q)).toBe(true); // still
    expect(ballSpinAt(store, 5, 0, r).equals(q)).toBe(true); // placed, not rolled
    expect(ballSpinAt(store, 3, 0, r).equals(ballSpinAt(store, 3, 0, r))).toBe(true);
    // A fast ball: at most MAX_ROLL a cycle.
    expect(angle(ballSpinAt(frames([0, 2]), 1, 0, r))).toBeCloseTo(MAX_ROLL);
  });
});

describe('the scenery settings', () => {
  it('are on by default, in the 3D tab', () => {
    const t = defaultTargets();
    const a = t.app;
    expect([a.grassStripes3d, a.sky3d, a.stands3d, a.ballPattern3d]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(
      applySettings(t, {
        grass_stripes_3d: false,
        sky_3d: false,
        stands_3d: false,
        ball_pattern_3d: false,
      }),
    ).toHaveLength(4);
    expect([a.grassStripes3d, a.sky3d, a.stands3d, a.ballPattern3d]).toEqual([
      false,
      false,
      false,
      false,
    ]);
    resetView3d(a);
    expect(a.sky3d).toBe(true);
  });
});

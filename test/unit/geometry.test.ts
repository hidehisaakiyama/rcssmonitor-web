import { describe, expect, it } from 'vitest';
import {
  circleIntersections,
  isLeftOf,
  normalizeAngle,
  rint,
  rotate,
  vectorAngle,
} from '../../src/core/geometry';

describe('rint', () => {
  it.each([
    [0.5, 0],
    [1.5, 2],
    [2.5, 2],
    [-0.5, -0],
    [-1.5, -2],
    [-2.5, -2],
    [2.4, 2],
    [2.6, 3],
    [-441.72, -442],
  ])('rint(%f) = %f', (x, r) => {
    expect(rint(x)).toBe(r);
  });
});

describe('angles', () => {
  it('normalizes to [-180, 180]', () => {
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(720 + 30)).toBe(30);
    expect(normalizeAngle(180)).toBe(180);
  });

  it('tells which angle is on the left', () => {
    // y points down, so -90 (up on the screen) is left of 0 when facing 0.
    expect(isLeftOf(-90, 0)).toBe(true);
    expect(isLeftOf(90, 0)).toBe(false);
    expect(isLeftOf(170, -170)).toBe(true);
    expect(isLeftOf(-170, 170)).toBe(false);
  });

  it('computes directions and rotations', () => {
    expect(vectorAngle(0, 1)).toBe(90);
    expect(vectorAngle(0, 0)).toBe(0);
    const v = rotate({ x: 1, y: 0 }, 90);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
  });
});

describe('circleIntersections', () => {
  it('finds two points', () => {
    const pts = circleIntersections({ x: 0, y: 0 }, 5, { x: 8, y: 0 }, 5);
    expect(pts).toHaveLength(2);
    const ys = pts.map((p) => p.y).sort((a, b) => a - b);
    expect(pts[0]?.x).toBeCloseTo(4);
    expect(ys[0]).toBeCloseTo(-3);
    expect(ys[1]).toBeCloseTo(3);
  });

  it('finds the touching point', () => {
    const pts = circleIntersections({ x: 0, y: 0 }, 1, { x: 0, y: 2 }, 1);
    expect(pts).toHaveLength(1);
    expect(pts[0]?.y).toBeCloseTo(1);
  });

  it('finds none for separate or nested circles', () => {
    expect(circleIntersections({ x: 0, y: 0 }, 1, { x: 5, y: 0 }, 1)).toEqual([]);
    expect(circleIntersections({ x: 0, y: 0 }, 5, { x: 1, y: 0 }, 1)).toEqual([]);
  });
});

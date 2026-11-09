// 2D geometry used by the painters (rcssmonitor src/angle_deg, vector_2d,
// circle_2d). Angles are in degrees; with y pointing down, positive angles
// turn clockwise on the screen.

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

/**
 * Rounds to the nearest integer, halves to even, like C's rint() in the
 * default rounding mode. rcssmonitor computes screen coordinates with it.
 */
export function rint(x: number): number {
  const r = Math.round(x);
  return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Normalizes an angle to [-180, 180] (AngleDeg::normalize_angle). */
export function normalizeAngle(deg: number): number {
  let d = deg;
  if (d < -360 || 360 < d) {
    d %= 360;
  }
  if (d < -180) {
    d += 360;
  }
  if (d > 180) {
    d -= 360;
  }
  return d;
}

/** Direction of a vector in degrees, normalized. 0 for the zero vector. */
export function vectorAngle(x: number, y: number): number {
  return x === 0 && y === 0 ? 0 : Math.atan2(y, x) * RAD2DEG;
}

/** True if angle `a` is on the left (counter-clockwise on the field) of `b` (AngleDeg::isLeftOf). */
export function isLeftOf(a: number, b: number): boolean {
  const diff = normalizeAngle(b) - normalizeAngle(a);
  return (0 < diff && diff < 180) || diff < -180;
}

/** Rotates a vector by `deg` degrees. */
export function rotate(v: Vec2, deg: number): Vec2 {
  const c = Math.cos(deg * DEG2RAD);
  const s = Math.sin(deg * DEG2RAD);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

export function polar(r: number, deg: number): Vec2 {
  return { x: r * Math.cos(deg * DEG2RAD), y: r * Math.sin(deg * DEG2RAD) };
}

/**
 * Intersection points of two circles. Returns 0, 1 or 2 points
 * (Circle2D::intersection, which solves the radical line against the first
 * circle).
 */
export function circleIntersections(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const relX = c2.x - c1.x;
  const relY = c2.y - c1.y;
  const dist = Math.hypot(relX, relY);
  if (dist < Math.abs(r1 - r2) || r1 + r2 < dist) {
    return [];
  }
  // Radical line a x + b y + c = 0.
  const a = -2 * relX;
  const b = -2 * relY;
  const c = c2.x * c2.x + c2.y * c2.y - r2 * r2 - (c1.x * c1.x + c1.y * c1.y) + r1 * r1;
  return lineCircleIntersections(a, b, c, c1, r1);
}

const EPSILON = 1.0e-5;

function lineCircleIntersections(a: number, b: number, c: number, center: Vec2, r: number): Vec2[] {
  if (Math.abs(a) < EPSILON) {
    if (Math.abs(b) < EPSILON) {
      return [];
    }
    const y = -c / b;
    return quadratic(1, -2 * center.x, center.x ** 2 + (c / b + center.y) ** 2 - r * r).map(
      (x) => ({ x, y }),
    );
  }
  const m = b / a;
  const d = c / a;
  const ys = quadratic(
    1 + m * m,
    2 * (-center.y + (d + center.x) * m),
    (d + center.x) ** 2 + center.y ** 2 - r * r,
  );
  return ys.map((y) => ({ x: -(b * y + c) / a, y }));
}

function quadratic(a: number, b: number, c: number): number[] {
  const disc = b * b - 4 * a * c;
  // rcssmonitor ignores small noise in the discriminant.
  if (Math.abs(disc) < 0.001) {
    return [-b / (2 * a)];
  }
  if (disc < 0) {
    return [];
  }
  const sq = Math.sqrt(disc);
  return [(-b + sq) / (2 * a), (-b - sq) / (2 * a)];
}

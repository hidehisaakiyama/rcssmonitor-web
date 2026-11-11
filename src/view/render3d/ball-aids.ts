// What helps to find the ball in the 3D view, where it is small (the 3D
// tab's Ball group):
// - a ring on the ground around it (BallRing), 0.7 m by default (the
//   default kickable_margin), its line never thinner than RING_PIXELS on
//   the screen, over a faint fill;
// - a trail behind it like a contrail (BallTrail): a ribbon through the
//   ball's centers of the last cycles (ballTrailPoints), facing the camera,
//   dense along its middle and clear at its edges, narrower and fainter the
//   older, its head never thinner than TRAIL_PIXELS. From the log alone, so that a stepped or rewound view
//   shows the same; it breaks where the ball was placed.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { BallState } from '../../core/frame';
import type { GameStore } from '../../core/game-store';
import { PLACED } from './ball';
import { ballCenterHeight, type World } from './scene-math';

export const BALL_AIDS = Object.freeze({
  /** The ring's radius by default: the default kickable_margin (m). */
  ringRadius: 0.7,
  ringRange: { min: 0.1, max: 5 },
  /** The trail by default: as long as the ball went in this many cycles. */
  trailCycles: 5,
  trailRange: { min: 1, max: 30 },
});

/** The ring's line: this wide (m), or this many pixels where that is thinner. */
const RING_WIDTH = 0.06;
const RING_PIXELS = 2;
const RING_FILL = 0.12;
/**
 * The trail's head: 1.5 times the ball's width (it fades to its edges), or
 * this many pixels where that is thinner; and how opaque along its middle.
 */
export const TRAIL_WIDTH = 3;
export const TRAIL_PIXELS = 6;
const TRAIL_OPACITY = 0.75;
/** The heights of the ring above the ground (under the ball's shadow at 0.03). */
const RING_HEIGHT = 0.028;

/** A point of the trail: the ball's center, and how many cycles ago it was there. */
export interface TrailPoint extends World {
  readonly age: number;
}

/**
 * The ball's centers from the time drawn (frame `index`, `alpha` of the way
 * to the next) back `cycles` cycles: the drawn place, the frames before it,
 * and the last one between two frames, so that it is exactly `cycles` long
 * in time. It stops before a placement or where the log has no frame.
 */
export function ballTrailPoints(
  store: GameStore | null,
  index: number,
  alpha: number,
  cycles: number,
  radius: number,
): TrailPoint[] {
  if (!store || index < 0 || index >= store.frameCount) {
    return [];
  }
  const center = (b: BallState) => ({ x: b.x, y: ballCenterHeight(b, radius), z: b.y });
  const here = store.frame(index)?.ball;
  if (!here) {
    return [];
  }
  const next = index + 1 < store.frameCount ? store.frame(index + 1)?.ball : undefined;
  const points: TrailPoint[] = [];
  const lerp = (a: World, b: World, t: number): World => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  });
  const placed = (a: BallState, b: BallState) => Math.hypot(b.x - a.x, b.y - a.y) > PLACED;
  if (alpha > 0 && next && !placed(here, next)) {
    points.push({ ...lerp(center(here), center(next), alpha), age: 0 });
  }
  let later = here;
  let laterAge = alpha;
  if (points.length === 0) {
    laterAge = 0;
  }
  points.push({ ...center(here), age: laterAge });
  for (let k = 1; laterAge < cycles; ++k) {
    const earlier = index - k >= 0 ? store.frame(index - k)?.ball : undefined;
    if (!earlier || placed(earlier, later)) {
      break;
    }
    const age = laterAge + 1;
    if (age > cycles) {
      // Part of the way to it.
      const t = (cycles - laterAge) / (age - laterAge);
      points.push({ ...lerp(center(later), center(earlier), t), age: cycles });
      break;
    }
    points.push({ ...center(earlier), age });
    later = earlier;
    laterAge = age;
  }
  return points;
}

/**
 * The trail as a ribbon of triangles: three vertices a point (an edge, the
 * middle, the other edge), across it facing `eye`, `width(age)` wide, the
 * middle with the opacity of its age and the edges clear; two quads
 * between points. Positions (x, y, z), opacities and the triangles.
 */
export function trailRibbon(
  points: readonly TrailPoint[],
  eye: World,
  width: (age: number) => number,
  opacity: (age: number) => number,
): { positions: number[]; alphas: number[]; indices: number[] } {
  const positions: number[] = [];
  const alphas: number[] = [];
  const indices: number[] = [];
  if (points.length < 2) {
    return { positions, alphas, indices };
  }
  const along = new Vector3();
  const view = new Vector3();
  const across = new Vector3();
  const last = new Vector3(0, 0, 1);
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)] ?? p;
    const b = points[Math.min(points.length - 1, i + 1)] ?? p;
    along.set(b.x - a.x, b.y - a.y, b.z - a.z);
    view.set(eye.x - p.x, eye.y - p.y, eye.z - p.z);
    across.crossVectors(along, view);
    // Where the ball goes straight at the camera, or does not move: as the last.
    if (across.lengthSq() < 1e-12) {
      across.copy(last);
    } else {
      across.normalize();
      last.copy(across);
    }
    const w = width(p.age) / 2;
    positions.push(
      p.x + across.x * w,
      p.y + across.y * w,
      p.z + across.z * w,
      p.x,
      p.y,
      p.z,
      p.x - across.x * w,
      p.y - across.y * w,
      p.z - across.z * w,
    );
    alphas.push(0, opacity(p.age), 0);
    if (i > 0) {
      indices.push(...ribbonQuads(i));
    }
  });
  return { positions, alphas, indices };
}

/** The triangles between point `i - 1` and point `i` of the ribbon (three vertices a point). */
function ribbonQuads(i: number): number[] {
  const [l0, c0, r0] = [3 * i - 3, 3 * i - 2, 3 * i - 1];
  const [l1, c1, r1] = [3 * i, 3 * i + 1, 3 * i + 2];
  return [l0, c0, l1, c0, c1, l1, c0, r0, c1, r0, r1, c1];
}

const RING_VERTEX = /* glsl */ `
varying vec2 vAt;
void main() {
  // On the ground: the plane's x and z.
  vAt = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const RING_FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform float outer;
uniform float width;
uniform float fill;
varying vec2 vAt;
void main() {
  float d = length(vAt) * outer;
  float aa = max(fwidth(d), 1e-4);
  float inRing = smoothstep(outer - width - aa, outer - width, d) * (1.0 - smoothstep(outer - aa, outer, d));
  float inside = 1.0 - smoothstep(outer - width - aa, outer - width, d);
  float a = max(inRing * 0.9, inside * fill);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(color, a);
  #include <colorspace_fragment>
}`;

/** The ring on the ground around the ball. */
export class BallRing {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      uniforms: {
        color: { value: new Color(0xffffff) },
        outer: { value: 1 },
        width: { value: RING_WIDTH },
        fill: { value: RING_FILL },
      },
      vertexShader: RING_VERTEX,
      fragmentShader: RING_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    // From -1 to 1 on the ground, as large as the ring (scale).
    this.mesh = new Mesh(new PlaneGeometry(2, 2).rotateX(-Math.PI / 2), this.material);
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /**
   * Around the ball's place on the ground, `radius` m; its line
   * `metersPerPixel` there times RING_PIXELS at the least.
   */
  update(
    at: { x: number; z: number },
    radius: number,
    metersPerPixel: number,
    color: string,
  ): void {
    const width = Math.min(radius * 0.5, Math.max(RING_WIDTH, RING_PIXELS * metersPerPixel));
    const u = this.material.uniforms;
    (u['outer'] as { value: number }).value = radius;
    (u['width'] as { value: number }).value = width;
    (u['color'] as { value: Color }).value.set(color);
    this.mesh.scale.setScalar(radius);
    this.mesh.position.set(at.x, RING_HEIGHT, at.z);
  }

  /** The line's width (m) as drawn, for the tests. */
  get width(): number {
    return (this.material.uniforms['width'] as { value: number }).value;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** The trail behind the ball. */
export class BallTrail {
  readonly mesh: Mesh;
  private readonly geometry = new BufferGeometry();
  private readonly material: MeshBasicMaterial;
  /** Room for this many points (three vertices each). */
  private capacity = 0;
  /** The points drawn last, for the tests. */
  points = 0;

  constructor() {
    this.material = new MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.allocate(BALL_AIDS.trailRange.max + 2);
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false; // it changes every frame
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  /**
   * Through `points` (ballTrailPoints, `cycles` long), facing `eye`: the
   * ball's width at the head (`headWidth`, m), nothing at the tail.
   */
  update(
    points: readonly TrailPoint[],
    eye: World,
    headWidth: number,
    cycles: number,
    color: string,
  ): void {
    const left = (age: number) => Math.max(0, 1 - age / Math.max(1e-6, cycles));
    const ribbon = trailRibbon(
      points,
      eye,
      (age) => headWidth * Math.pow(left(age), 0.6),
      (age) => TRAIL_OPACITY * left(age),
    );
    this.points = ribbon.indices.length > 0 ? Math.min(points.length, this.capacity) : 0;
    this.mesh.visible = this.points > 0;
    if (!this.mesh.visible) {
      return;
    }
    const c = new Color(color);
    const position = this.geometry.getAttribute('position') as BufferAttribute;
    const colors = this.geometry.getAttribute('color') as BufferAttribute;
    (position.array as Float32Array).set(ribbon.positions.slice(0, this.points * 9));
    const rgba = colors.array as Float32Array;
    ribbon.alphas.slice(0, this.points * 3).forEach((a, i) => {
      rgba.set([c.r, c.g, c.b, a], i * 4);
    });
    position.needsUpdate = true;
    colors.needsUpdate = true;
    // The quads between the points: the same indices every time (allocate).
    this.geometry.setDrawRange(0, (this.points - 1) * 12);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  /**
   * Room for `n` points, made once: buffers written every frame (a new one
   * every frame would leave its GPU buffer behind), and the indices of the
   * quads between the points, which do not change.
   */
  private allocate(n: number): void {
    const position = new BufferAttribute(new Float32Array(n * 3 * 3), 3).setUsage(DynamicDrawUsage);
    const color = new BufferAttribute(new Float32Array(n * 3 * 4), 4).setUsage(DynamicDrawUsage);
    const indices: number[] = [];
    for (let i = 1; i < n; ++i) {
      indices.push(...ribbonQuads(i));
    }
    this.geometry.setAttribute('position', position);
    this.geometry.setAttribute('color', color);
    this.geometry.setIndex(indices);
    this.capacity = n;
  }
}

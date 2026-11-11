// The ball of the 3D view with the pattern of a football (the 3D tab's Ball
// Pattern): twelve dark pentagons, drawn by the shader from the direction
// on the ball, so that their edges stay sharp however near the camera is.
// It rolls as far as the log says it went (ballSpinAt), from the frames
// alone, so that a paused, stepped or rewound view shows it turned the same.
import { MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import type { GameStore } from '../../core/game-store';

/** At most this much a cycle (radians), so that a fast ball does not seem to turn back at 60 fps. */
export const MAX_ROLL = 0.8 * Math.PI;
/** Farther than this in a cycle (m) is a placement (a kick-off, a free kick), not rolling. */
export const PLACED = 5;

/** The corners of an icosahedron (the pentagons' centers), and for each a neighbor (a corner's direction). */
export function pentagonCenters(): { centers: Vector3[]; toward: Vector3[] } {
  const phi = (1 + Math.sqrt(5)) / 2;
  const centers: Vector3[] = [];
  for (const a of [-1, 1]) {
    for (const b of [-phi, phi]) {
      centers.push(
        new Vector3(0, a, b).normalize(),
        new Vector3(a, b, 0).normalize(),
        new Vector3(b, 0, a).normalize(),
      );
    }
  }
  const toward = centers.map((c) => {
    let best = c;
    let dot = -2;
    for (const o of centers) {
      const d = o.dot(c);
      if (o !== c && d > dot) {
        dot = d;
        best = o;
      }
    }
    return best.clone();
  });
  return { centers, toward };
}

/**
 * The pentagons' size: as on a truncated icosahedron, their corners a third
 * of the way to the neighbors (about 21 degrees from the center).
 */
const PENTAGON = 0.368;

/** A Lambert material in the ball color, with the pentagons while `patterned` (a uniform: no recompile). */
export function ballMaterial(): { material: MeshLambertMaterial; setPatterned(on: boolean): void } {
  const material = new MeshLambertMaterial({ color: 0xffffff });
  const { centers, toward } = pentagonCenters();
  const patterned = { value: 1 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms['ballCenters'] = { value: centers };
    shader.uniforms['ballToward'] = { value: toward };
    shader.uniforms['ballPatterned'] = patterned;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBallDirection;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBallDirection = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 ballCenters[12];
uniform vec3 ballToward[12];
uniform float ballPatterned;
varying vec3 vBallDirection;
float ballPattern(vec3 n) {
  int best = 0;
  float nearest = -2.0;
  for (int i = 0; i < 12; ++i) {
    float d = dot(n, ballCenters[i]);
    if (d > nearest) {
      nearest = d;
      best = i;
    }
  }
  vec3 v = ballCenters[best];
  vec3 e1 = normalize(ballToward[best] - v * dot(ballToward[best], v));
  vec3 e2 = cross(v, e1);
  // Around the center, from a corner; the edges' normals are 36 degrees off the corners.
  float sector = 1.2566371;
  float a = mod(atan(dot(n, e2), dot(n, e1)), sector) - 0.5 * sector;
  float r = acos(clamp(nearest, -1.0, 1.0)) * cos(a);
  float edge = ${PENTAGON.toFixed(4)} * 0.8090170;
  float w = max(fwidth(r), 1e-4);
  return mix(0.12, 1.0, smoothstep(edge - w, edge + w, r));
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb *= mix(1.0, ballPattern(normalize(vBallDirection)), ballPatterned);`,
      );
  };
  return {
    material,
    setPatterned(on: boolean) {
      patterned.value = on ? 1 : 0;
    },
  };
}

/** The ball's turn at each frame of a store, for a radius. */
interface SpinTable {
  radius: number;
  frames: number;
  /** x, y, z, w by frame. */
  readonly turns: number[];
}

const spins = new WeakMap<GameStore, SpinTable>();

/** The turn of rolling from `a` to `b` (field coordinates) on a ball of `radius`, or null. */
function roll(
  a: { x: number; y: number },
  b: { x: number; y: number },
  radius: number,
  out: Quaternion,
  k = 1,
): Quaternion | null {
  // World: X = field x, Z = field y. Rolling along d turns about up x d.
  const dx = b.x - a.x;
  const dz = b.y - a.y;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6 || d > PLACED) {
    return null;
  }
  const angle = Math.min(MAX_ROLL, d / Math.max(1e-3, radius)) * k;
  return out.setFromAxisAngle(new Vector3(dz / d, 0, -dx / d), angle);
}

function spinTable(store: GameStore, radius: number): SpinTable {
  let t = spins.get(store);
  if (!t || t.radius !== radius) {
    t = { radius, frames: 0, turns: [] };
    spins.set(store, t);
  }
  const q = new Quaternion();
  const step = new Quaternion();
  for (let i = t.frames; i < store.frameCount; ++i) {
    if (i > 0) {
      const at = (i - 1) * 4;
      q.set(t.turns[at] ?? 0, t.turns[at + 1] ?? 0, t.turns[at + 2] ?? 0, t.turns[at + 3] ?? 1);
      const a = store.frame(i - 1)?.ball;
      const b = store.frame(i)?.ball;
      if (a && b && roll(a, b, radius, step)) {
        q.premultiply(step).normalize();
      }
    } else {
      q.identity();
    }
    t.turns.push(q.x, q.y, q.z, q.w);
  }
  t.frames = store.frameCount;
  return t;
}

/**
 * How the ball of `radius` is turned at frame `index` and `alpha` of the
 * way to the next: rolled along its path from the first frame, at most
 * MAX_ROLL a cycle.
 */
export function ballSpinAt(
  store: GameStore | null,
  index: number,
  alpha: number,
  radius: number,
  out = new Quaternion(),
): Quaternion {
  if (!store || store.frameCount === 0) {
    return out.identity();
  }
  const t = spinTable(store, radius);
  const i = Math.min(Math.max(0, index), store.frameCount - 1);
  out.set(
    t.turns[i * 4] ?? 0,
    t.turns[i * 4 + 1] ?? 0,
    t.turns[i * 4 + 2] ?? 0,
    t.turns[i * 4 + 3] ?? 1,
  );
  const a = store.frame(i)?.ball;
  const b = i + 1 < store.frameCount ? store.frame(i + 1)?.ball : undefined;
  const step = new Quaternion();
  if (alpha > 0 && a && b && roll(a, b, radius, step, alpha)) {
    out.premultiply(step).normalize();
  }
  return out;
}

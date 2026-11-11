// The scenery of the 3D view, each part shown or not by the 3D tab of the
// preference dialog:
// - the grass mowed in stripes across the pitch (grassBands, drawn on the
//   field texture under the lines);
// - the sky: a dome around the camera from the pale horizon to the blue
//   above, with a haze that melts the far ground into it;
// - simple stands along both touch lines, beyond the boards, with a crowd
//   that wears more of the team color on its team's half. Not behind the
//   goals, where the banners float and the goal cameras are. Their faces
//   look to the pitch and up only, so that from a camera in or behind them
//   (a close-up near the touch line) they do not hide the pitch.
import {
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  Float32BufferAttribute,
  Fog,
  Group,
  Mesh,
  MeshLambertMaterial,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  BackSide,
  Vector3,
} from 'three';
import { PITCH } from '../../core/constants';
import type { QtPainter } from '../render2d/qt-painter';
import type { Viewport } from '../render2d/viewport';
import { BOARDS, shade, TEXTURE_AREA } from './scene-math';

// ---- grass

/** The mowed stripes: across the pitch, this wide, one edge on the halfway line. */
export const GRASS = Object.freeze({ width: PITCH.length / 20, light: 1.05, dark: 0.92 });

/**
 * The stripes over the drawn ground, from left to right: [from, to) in
 * field x, and whether it is a dark one. The stripes left and right of the
 * halfway line differ, as the mower turns there.
 */
export function grassBands(): { from: number; to: number; dark: boolean }[] {
  const half = TEXTURE_AREA.length / 2;
  const bands: { from: number; to: number; dark: boolean }[] = [];
  for (let k = Math.floor(-half / GRASS.width); k * GRASS.width < half; ++k) {
    bands.push({
      from: Math.max(-half, k * GRASS.width),
      to: Math.min(half, (k + 1) * GRASS.width),
      dark: k % 2 !== 0,
    });
  }
  return bands;
}

/** Paints the stripes of the field color, over it and under the lines (drawField's grass). */
export function paintGrassStripes(p: QtPainter, vp: Viewport, field: string): void {
  const light = shade(field, GRASS.light);
  const dark = shade(field, GRASS.dark);
  for (const b of grassBands()) {
    const x = vp.screenX(b.from);
    p.fillRect(x, 0, vp.screenX(b.to) - x, vp.height, b.dark ? dark : light);
  }
}

// ---- sky

export const SKY = Object.freeze({
  zenith: '#3d7ccc',
  horizon: '#d4e4f0',
  /** Below the horizon, beyond the ground: as the ground beyond the pitch, in the haze. */
  below: '#6f9f7f',
  /** The dome's radius, within the cameras' far plane (2000 m). */
  radius: 1900,
  /** The haze: none on the stadium, all of it at the edge of the ground (1500 m). */
  hazeFrom: 600,
  hazeTo: 1500,
});

/** How far the ground beyond the pitch goes from its center (m), to melt into the haze. */
export const FAR_GROUND = SKY.hazeTo;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 below;
varying vec3 vDirection;
void main() {
  float h = normalize(vDirection).y;
  vec3 c = h >= 0.0 ? mix(horizon, zenith, pow(h, 0.55)) : mix(horizon, below, min(1.0, -h * 12.0));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

/** The sky dome, to be kept around the camera (follow), and the haze that goes with it. */
export class Sky {
  readonly mesh: Mesh;
  readonly fog = new Fog(SKY.horizon, SKY.hazeFrom, SKY.hazeTo);
  private readonly material: ShaderMaterial;

  constructor() {
    const linear = (c: string) => new Color(c);
    this.material = new ShaderMaterial({
      uniforms: {
        zenith: { value: linear(SKY.zenith) },
        horizon: { value: linear(SKY.horizon) },
        below: { value: linear(SKY.below) },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new Mesh(new SphereGeometry(SKY.radius, 32, 16), this.material);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  /** Centered on the camera, so that it is as far in every direction. */
  follow(at: Vector3): void {
    this.mesh.position.copy(at);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

// ---- stands

export const STANDS = Object.freeze({
  /** From the touch line to the front of the stand (m), beyond the boards (BOARDS.offset). */
  front: BOARDS.offset + 2,
  rows: 16,
  /** How deep and how high a row is (m). */
  tread: 0.85,
  riser: 0.42,
  /** The wall under the first row. */
  base: 1.2,
  /** Along the touch line, from the center: as far as the boards. */
  halfLength: PITCH.length / 2 + BOARDS.offset,
  /** The crowd's texture: meters along the stand per tile, and pixels per meter. */
  tile: 8,
  px: 32,
});

/** The height of the top row of the stands (m). */
export const STAND_TOP = STANDS.base + (STANDS.rows - 1) * STANDS.riser;

/** The crowd's texture: the people over a row (v 0.1-1), and a plain band for the walls (v < 0.1). */
const WALL_V = 0.04;

/**
 * The stand of `side` (-1 far, +1 near: -y and +y of the field) on the half
 * of `end` (-1 left, +1 right): the rows (their fronts to the pitch, their
 * treads up), the wall under the first row, the outer end and the back
 * (out of the stadium), as triangles that face where they look.
 */
export function standGeometry(
  side: -1 | 1,
  end: -1 | 1,
): { positions: number[]; normals: number[]; uvs: number[] } {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const s = STANDS;
  const z = (d: number) => side * (PITCH.width / 2 + s.front + d);
  const x0 = end < 0 ? -s.halfLength : 0;
  const x1 = end < 0 ? 0 : s.halfLength;
  const u = (x: number, row: number) => x / s.tile + row * 0.37;
  /** A quad a-b-c-d (around it) facing `n`, with its uvs. */
  const quad = (
    corners: readonly (readonly [number, number, number])[],
    n: readonly [number, number, number],
    uv: readonly (readonly [number, number])[],
  ) => {
    const [a, b, c] = corners as [Vec, Vec, Vec, Vec];
    const [abx, aby, abz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const [acx, acy, acz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    // (b - a) x (c - a) along n: counterclockwise as seen from where it faces.
    const facing =
      (aby * acz - abz * acy) * n[0] +
        (abz * acx - abx * acz) * n[1] +
        (abx * acy - aby * acx) * n[2] >
      0;
    const order = facing ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const i of order) {
      const p = corners[i] as Vec;
      positions.push(p[0], p[1], p[2]);
      normals.push(n[0], n[1], n[2]);
      const t = uv[i] as readonly [number, number];
      uvs.push(t[0], t[1]);
    }
  };
  type Vec = readonly [number, number, number];
  const toPitch: Vec = [0, 0, -side];
  const out: Vec = [0, 0, side];
  const up: Vec = [0, 1, 0];
  const wall = (x: number) => [x / s.tile, WALL_V] as const;
  // The wall under the first row.
  quad(
    [
      [x0, 0, z(0)],
      [x1, 0, z(0)],
      [x1, s.base, z(0)],
      [x0, s.base, z(0)],
    ],
    toPitch,
    [wall(x0), wall(x1), wall(x1), wall(x0)],
  );
  for (let k = 0; k < s.rows; ++k) {
    const y = s.base + k * s.riser;
    // The row's tread, then the riser up to the next.
    quad(
      [
        [x0, y, z(k * s.tread)],
        [x1, y, z(k * s.tread)],
        [x1, y, z((k + 1) * s.tread)],
        [x0, y, z((k + 1) * s.tread)],
      ],
      up,
      [
        [u(x0, k), 0.1],
        [u(x1, k), 0.1],
        [u(x1, k), 0.55],
        [u(x0, k), 0.55],
      ],
    );
    if (k < s.rows - 1) {
      quad(
        [
          [x0, y, z((k + 1) * s.tread)],
          [x1, y, z((k + 1) * s.tread)],
          [x1, y + s.riser, z((k + 1) * s.tread)],
          [x0, y + s.riser, z((k + 1) * s.tread)],
        ],
        toPitch,
        [
          [u(x0, k), 0.55],
          [u(x1, k), 0.55],
          [u(x1, k), 1],
          [u(x0, k), 1],
        ],
      );
    }
    // The outer end of the row, down to the ground.
    const xe = end < 0 ? x0 : x1;
    quad(
      [
        [xe, 0, z(k * s.tread)],
        [xe, 0, z((k + 1) * s.tread)],
        [xe, y, z((k + 1) * s.tread)],
        [xe, y, z(k * s.tread)],
      ],
      [end, 0, 0],
      [wall(0), wall(1), wall(1), wall(0)],
    );
  }
  // The back.
  const back = z(s.rows * s.tread);
  quad(
    [
      [x0, 0, back],
      [x1, 0, back],
      [x1, STAND_TOP, back],
      [x0, STAND_TOP, back],
    ],
    out,
    [wall(x0), wall(x1), wall(x1), wall(x0)],
  );
  return { positions, normals, uvs };
}

/** A little random number generator, so that the crowd is the same every time. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The others in the crowd wear these. */
const CROWD = [
  '#f2f2f2',
  '#2a2a2a',
  '#8a8a8a',
  '#b03030',
  '#3050b0',
  '#d8c040',
  '#3a8a3a',
  '#c07030',
];
const SEATS = '#3c3c44';
const CONCRETE = '#8c8c90';
/** Of the crowd, those in the team color. */
const FANS = 0.45;

/** Draws one tile of the crowd of a team's half. */
function paintCrowd(canvas: HTMLCanvasElement, team: string): void {
  const s = STANDS;
  canvas.width = s.tile * s.px;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const h = canvas.height;
  ctx.fillStyle = SEATS;
  ctx.fillRect(0, 0, canvas.width, h);
  // The band for the walls (the bottom of the texture: v 0-0.1).
  ctx.fillStyle = CONCRETE;
  ctx.fillRect(0, h - Math.ceil(h * 0.1), canvas.width, Math.ceil(h * 0.1));
  const rand = random(7);
  const dark = shade(team, 0.7);
  // People about half a meter apart, a little off a line: the head and the
  // body up the riser (the top of the texture, v 0.55-1), the legs on the
  // tread before it, so that from above too the rows look full.
  for (let x = 2; x < canvas.width - 6; x += s.px / 2) {
    const fan = rand() < FANS;
    const color = fan
      ? rand() < 0.7
        ? team
        : dark
      : (CROWD[Math.floor(rand() * CROWD.length)] ?? SEATS);
    const dx = Math.round((rand() - 0.5) * 6);
    ctx.fillStyle = color;
    ctx.fillRect(x + dx, 3, 10, Math.round(h * 0.42));
    ctx.fillStyle = shade(color, 0.6);
    ctx.fillRect(x + dx + 1, 3 + Math.round(h * 0.42), 8, Math.round(h * 0.4));
    ctx.fillStyle = rand() < 0.5 ? '#e0b896' : '#8a5a3a';
    ctx.fillRect(x + dx + 2, 0, 6, 4);
  }
}

/** The stands: one mesh for each half of each touch line, in the crowd of that half's team. */
export class Stands {
  readonly group = new Group();
  private readonly canvases = [document.createElement('canvas'), document.createElement('canvas')];
  private readonly textures: CanvasTexture[];
  private readonly materials: MeshLambertMaterial[];
  private readonly geometries: BufferGeometry[] = [];
  private drawn = ['', ''];

  constructor(anisotropy: number) {
    this.textures = this.canvases.map((c) => {
      const t = new CanvasTexture(c);
      t.colorSpace = SRGBColorSpace;
      t.wrapS = RepeatWrapping;
      t.wrapT = ClampToEdgeWrapping;
      t.anisotropy = anisotropy;
      return t;
    });
    this.materials = this.textures.map((map) => new MeshLambertMaterial({ map }));
    for (const side of [-1, 1] as const) {
      for (const end of [-1, 1] as const) {
        const g = standGeometry(side, end);
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(g.positions, 3));
        geometry.setAttribute('normal', new Float32BufferAttribute(g.normals, 3));
        geometry.setAttribute('uv', new Float32BufferAttribute(g.uvs, 2));
        this.geometries.push(geometry);
        const material = this.materials[end < 0 ? 0 : 1];
        if (material) {
          this.group.add(new Mesh(geometry, material));
        }
      }
    }
  }

  /** The crowds of the left and the right half, in the team colors. */
  update(colors: readonly [string, string]): void {
    colors.forEach((color, i) => {
      const canvas = this.canvases[i];
      const texture = this.textures[i];
      if (canvas && texture && this.drawn[i] !== color) {
        this.drawn[i] = color;
        paintCrowd(canvas, color);
        texture.needsUpdate = true;
      }
    });
  }

  dispose(): void {
    for (const d of [...this.geometries, ...this.textures, ...this.materials]) {
      d.dispose();
    }
  }
}

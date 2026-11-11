// The surroundings of the pitch in the team colors (DEVELOPMENT_PLAN.md,
// Phase 6), so that the two ends can be told apart, above all from the
// player camera. Each can be hidden (the 3D tab of the preference dialog):
// - boards around the pitch (scene-math.ts BOARDS); along the touch lines
//   they change color at the halfway line;
// - a banner floating high behind each goal (BANNER), with the team name and
//   logo.
// Both are a dark shade of the team color with the name, an edge and the
// logo in the team color, so that the players, in the team colors, stand out
// against them, and the goals against the sky and the ground beyond.
// rcssserver does not change ends, so the left team keeps the left goal for
// the whole game. The goal nets are tinted in render3d.ts. Unlit, as the
// field, so that the colors stay as chosen.
import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { PITCH } from '../../core/constants';
import type { TeamGraphic } from '../../core/team-graphic';
import { BANNER, BOARD_SHADE, BOARDS, shade } from './scene-math';

/** What one end shows. */
export interface TeamLook {
  readonly color: string;
  /** Empty before the team connects. */
  readonly name: string;
  /** The logo, when the Team Graphic option is on and it has arrived. */
  readonly logo: TeamGraphic | null;
}

/** What the end-to-end tests read: the ends left then right, and what is shown. */
export interface StadiumState {
  readonly sides: readonly { color: string; name: string; logo: boolean }[];
  readonly boards: boolean;
  readonly banners: boolean;
}

/** Pixels per meter of the textures. */
const BOARD_PX = 64;
const BANNER_PX = 24;
const FONT = 'sans-serif';

/** One end: the textures of its boards and its banner. */
class End {
  readonly boardCanvas = document.createElement('canvas');
  readonly bannerCanvas = document.createElement('canvas');
  readonly boardTexture: CanvasTexture;
  readonly bannerTexture: CanvasTexture;
  /** The backs: plain, the dark shade. */
  readonly back = new MeshBasicMaterial();
  private drawn = '';
  private logoDrawn: TeamGraphic | null = null;
  state = { color: '', name: '', logo: false };

  constructor(anisotropy: number) {
    this.boardTexture = new CanvasTexture(this.boardCanvas);
    this.boardTexture.wrapS = RepeatWrapping;
    this.bannerTexture = new CanvasTexture(this.bannerCanvas);
    for (const t of [this.boardTexture, this.bannerTexture]) {
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = anisotropy;
    }
  }

  /** Draws the textures again when the look changed. */
  update(look: TeamLook): void {
    const logo = look.logo && !look.logo.isEmpty() ? look.logo : null;
    const key = JSON.stringify([look.color, look.name, logo?.revision ?? -1]);
    if (key === this.drawn && logo === this.logoDrawn) {
      return;
    }
    this.drawn = key;
    this.logoDrawn = logo;
    this.state = { color: look.color, name: look.name, logo: logo !== null };
    const dark = shade(look.color, BOARD_SHADE);
    this.drawBoard(look, dark);
    this.drawBanner(look, dark, logo);
    this.back.color.set(dark);
    this.boardTexture.needsUpdate = true;
    this.bannerTexture.needsUpdate = true;
  }

  dispose(): void {
    this.boardTexture.dispose();
    this.bannerTexture.dispose();
    this.back.dispose();
  }

  /** One tile of the boards: the dark shade, edges and the name in the team color. */
  private drawBoard(look: TeamLook, dark: string): void {
    const c = this.boardCanvas;
    c.width = BOARDS.tile * BOARD_PX;
    c.height = BOARDS.height * BOARD_PX;
    const ctx = c.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = look.color;
    ctx.fillRect(0, 0, c.width, 5);
    ctx.fillRect(0, c.height - 3, c.width, 3);
    if (look.name) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const size = fitFont(ctx, look.name, 36, c.width * 0.9);
      ctx.font = `bold ${size}px ${FONT}`;
      ctx.fillText(look.name, c.width / 2, c.height / 2 + 2);
    }
  }

  /** The banner: the logo and the name side by side, as large as they fit, in a frame. */
  private drawBanner(look: TeamLook, dark: string, logo: TeamGraphic | null): void {
    const c = this.bannerCanvas;
    c.width = BANNER.width * BANNER_PX;
    c.height = BANNER.height * BANNER_PX;
    const ctx = c.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = look.color;
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, c.width - 8, c.height - 8);
    // Whole pixels for the logo (at most 256 x 64), as the 2D view draws it.
    const k = logo
      ? Math.max(1, Math.floor(Math.min((c.height * 0.7) / logo.height, 440 / logo.width)))
      : 0;
    const logoWidth = logo ? logo.width * k : 0;
    const gap = logo && look.name ? 32 : 0;
    const size = look.name ? fitFont(ctx, look.name, 96, c.width * 0.9 - logoWidth - gap) : 0;
    ctx.font = `bold ${size}px ${FONT}`;
    const nameWidth = look.name ? ctx.measureText(look.name).width : 0;
    let x = (c.width - logoWidth - gap - nameWidth) / 2;
    if (logo) {
      const image = document.createElement('canvas');
      image.width = logo.width;
      image.height = logo.height;
      image
        .getContext('2d')
        ?.putImageData(new ImageData(logo.toRgba(), logo.width, logo.height), 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, x, (c.height - logo.height * k) / 2, logoWidth, logo.height * k);
      x += logoWidth + gap;
    }
    if (look.name) {
      ctx.fillStyle = look.color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(look.name, x, c.height / 2 + 4);
    }
  }
}

/** The largest bold font size up to `max` px with which `text` fits in `width`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, max: number, width: number): number {
  ctx.font = `bold ${max}px ${FONT}`;
  const w = ctx.measureText(text).width;
  return w <= width ? max : Math.max(8, Math.floor((max * width) / w));
}

export class Stadium {
  readonly group = new Group();
  private readonly boards = new Group();
  private readonly banners = new Group();
  private readonly ends: [End, End];
  private readonly disposables: { dispose(): void }[] = [];

  constructor(anisotropy: number) {
    this.group.add(this.boards, this.banners);
    this.ends = [new End(anisotropy), new End(anisotropy)];
    this.ends.forEach((end, i) => this.build(end, i === 0 ? -1 : 1));
  }

  /** The looks of the left and the right end. */
  update(looks: readonly [TeamLook, TeamLook]): void {
    this.ends[0].update(looks[0]);
    this.ends[1].update(looks[1]);
  }

  /** Shows or hides the boards and the banners. */
  show(shown: { boards: boolean; banners: boolean }): void {
    this.boards.visible = shown.boards;
    this.banners.visible = shown.banners;
  }

  inspect(): StadiumState {
    return {
      sides: this.ends.map((e) => ({ ...e.state })),
      boards: this.boards.visible,
      banners: this.banners.visible,
    };
  }

  dispose(): void {
    for (const e of this.ends) {
      e.dispose();
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  /** The boards of one half and its goal line, and the banner (side: -1 left, +1 right). */
  private build(end: End, side: -1 | 1): void {
    const board = this.track(new MeshBasicMaterial({ map: end.boardTexture }));
    const banner = this.track(new MeshBasicMaterial({ map: end.bannerTexture }));
    const x = PITCH.length / 2 + BOARDS.offset;
    const z = PITCH.width / 2 + BOARDS.offset;
    const h = BOARDS.height;
    const tile = BOARDS.tile;
    // Along the touch lines, from the halfway line to the corner, facing the pitch.
    const along = { x: (side * x) / 2, y: h / 2 };
    this.panel(this.boards, board, end.back, x, h, { ...along, z }, Math.PI, tile);
    this.panel(this.boards, board, end.back, x, h, { ...along, z: -z }, 0, tile);
    // Behind the goal line.
    const facing = (-side * Math.PI) / 2;
    const goalLine = { x: side * x, y: h / 2, z: 0 };
    this.panel(this.boards, board, end.back, 2 * z, h, goalLine, facing, tile);
    // High above, behind the goal.
    const at = {
      x: side * (PITCH.length / 2 + BANNER.behind),
      y: BANNER.bottom + BANNER.height / 2,
      z: 0,
    };
    this.panel(this.banners, banner, end.back, BANNER.width, BANNER.height, at, facing);
  }

  /**
   * A panel `width` x `height` centered at `at`, its front turned by `turn`
   * about Y from +Z, with the texture once in every `tile` meters across (or
   * once over the whole), and a plain back.
   */
  private panel(
    parent: Group,
    front: MeshBasicMaterial,
    back: MeshBasicMaterial,
    width: number,
    height: number,
    at: { x: number; y: number; z: number },
    turn: number,
    tile = width,
  ): void {
    const geometry = this.track(new PlaneGeometry(width, height));
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; ++i) {
      uv.setX(i, (uv.getX(i) * width) / tile);
    }
    for (const [material, angle] of [
      [front, turn],
      [back, turn + Math.PI],
    ] as const) {
      const m = new Mesh(geometry, material);
      m.position.set(at.x, at.y, at.z);
      m.rotation.y = angle;
      parent.add(m);
    }
  }

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }
}

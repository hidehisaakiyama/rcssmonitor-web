// Overlay drawn above either renderer: the score board, the team logos and
// the measuring tool (rcssmonitor src/score_board_painter.cpp,
// src/team_graphic_painter.cpp), and over the 3D view the compass and the
// minimap when they are on (guides.ts).
import type { Vec2 } from '../../core/geometry';
import { DEFAULT_SERVER_PARAM } from '../../core/params';
import type { TeamGraphic } from '../../core/team-graphic';
import { cssFont } from '../palette';
import { drawMeasure, type Measure } from '../render2d/measure-painter';
import { QtPainter } from '../render2d/qt-painter';
import type { SceneSnapshot, ScreenLabel } from '../renderer';
import { interpolateFrame } from '../render3d/interpolate';
import type { ViewState } from '../view-state';
import {
  compassRect,
  drawCompass,
  drawMinimap,
  MinimapField,
  minimapRect,
  type CameraGuide,
  type CompassMarks,
  type Rect,
} from './guides';
import { scoreBoardText } from './score-board';

interface LogoCache {
  graphic: TeamGraphic;
  revision: number;
  image: HTMLCanvasElement | null;
}

export class Hud {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly painter: QtPainter;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private readonly logos: [LogoCache | null, LogoCache | null] = [null, null];
  private readonly minimapField = new MinimapField();
  /** What the guides drew last, for the end-to-end tests. */
  guides: { compass: CompassMarks | null; minimap: Rect | null } = { compass: null, minimap: null };

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hud-layer';
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D is not available');
    }
    this.ctx = ctx;
    this.painter = new QtPainter(ctx);
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.painter.bounds = { width, height };
  }

  render(
    scene: SceneSnapshot | null,
    view: ViewState,
    measure: Measure | null,
    toField: (x: number, y: number) => Vec2,
    guide: CameraGuide | null = null,
    labels: readonly ScreenLabel[] = [],
  ): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.drawLabels(view, labels);
    this.drawGuides(scene, view, guide);
    if (scene) {
      if (view.options.showScoreBoard) {
        this.drawScoreBoard(scene, view);
      }
      if (view.options.showTeamGraphic) {
        this.drawLogos(scene, view);
      }
    }
    if (measure) {
      drawMeasure(this.painter, view, measure, toField);
    }
  }

  /**
   * The 3D overlays' texts, in the player font, beside their points as in
   * 2D; one that would cover another goes a line down (from afar, a
   * player's tackle text and its kick's are close).
   */
  private drawLabels(view: ViewState, labels: readonly ScreenLabel[]): void {
    if (labels.length === 0) {
      return;
    }
    const p = this.painter;
    p.setFont(cssFont(view.fonts.player));
    const ascent = p.fontAscent();
    const height = p.fontHeight();
    const placed: { x: number; y: number; width: number }[] = [];
    for (const l of labels) {
      const x = Math.round(l.x + 10);
      const width = p.textWidth(l.text);
      let y = Math.round(l.y + 2);
      while (
        placed.some((q) => x < q.x + q.width && q.x < x + width && Math.abs(q.y - y) < height)
      ) {
        y += height;
      }
      placed.push({ x, y, width });
      p.setPen(l.color);
      p.drawText(x, y + ascent, l.text);
    }
  }

  /** The compass and the minimap over the 3D view, between frames as the 3D view moves. */
  private drawGuides(scene: SceneSnapshot | null, view: ViewState, guide: CameraGuide | null) {
    this.guides = { compass: null, minimap: null };
    if (!guide) {
      return;
    }
    const frame = scene ? interpolateFrame(scene.frame, scene.next, scene.alpha) : null;
    if (guide.compass) {
      const r = compassRect(this.width);
      this.guides.compass = drawCompass(this.ctx, r, guide, view, frame?.ball ?? null);
    }
    if (guide.minimap) {
      const r = minimapRect(this.width, this.height);
      const sp = scene?.store.serverParam ?? DEFAULT_SERVER_PARAM;
      const field = this.minimapField.image(view, sp, r, this.dpr);
      drawMinimap(this.ctx, r, guide, view, frame, field);
      this.guides.minimap = r;
    }
  }

  private drawScoreBoard(scene: SceneSnapshot, view: ViewState): void {
    const text = scoreBoardText(scene.store, scene.frameIndex);
    const p = this.painter;
    p.setFont(cssFont(view.fonts.scoreBoard));
    const height = p.fontHeight();
    const top = this.height - height;
    p.fillRect(0, top, Math.ceil(p.textWidth(text)), height, view.colors.scoreBoardBrush);
    p.setPen(view.colors.scoreBoardPen);
    p.drawText(0, top + p.fontAscent(), text);
  }

  private drawLogos(scene: SceneSnapshot, view: ViewState): void {
    const scale = Math.max(0.001, view.options.teamGraphicScale);
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    scene.store.teamGraphics.forEach((graphic, i) => {
      const image = this.logo(i, graphic);
      if (!image) {
        return;
      }
      const w = image.width * scale;
      const h = image.height * scale;
      ctx.drawImage(image, i === 0 ? 0 : this.width - w, 0, w, h);
    });
  }

  private logo(i: number, graphic: TeamGraphic): HTMLCanvasElement | null {
    const cached = this.logos[i];
    if (cached && cached.graphic === graphic && cached.revision === graphic.revision) {
      return cached.image;
    }
    let image: HTMLCanvasElement | null = null;
    if (!graphic.isEmpty()) {
      image = document.createElement('canvas');
      image.width = graphic.width;
      image.height = graphic.height;
      image
        .getContext('2d')
        ?.putImageData(new ImageData(graphic.toRgba(), graphic.width, graphic.height), 0, 0);
    }
    this.logos[i] = { graphic, revision: graphic.revision, image };
    return image;
  }
}

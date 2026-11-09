// Overlay drawn above either renderer: the score board, the team logos and
// the measuring tool (rcssmonitor src/score_board_painter.cpp,
// src/team_graphic_painter.cpp).
import type { Vec2 } from '../../core/geometry';
import type { TeamGraphic } from '../../core/team-graphic';
import { cssFont } from '../palette';
import { drawMeasure, type Measure } from '../render2d/measure-painter';
import { QtPainter } from '../render2d/qt-painter';
import type { SceneSnapshot } from '../renderer';
import type { ViewState } from '../view-state';
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
  private readonly logos: [LogoCache | null, LogoCache | null] = [null, null];

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
  ): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
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

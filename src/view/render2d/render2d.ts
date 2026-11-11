// The 2D renderer: rcssmonitor's FieldCanvas drawing on a Canvas 2D context.
import type { Vec2 } from '../../core/geometry';
import { DEFAULT_SERVER_PARAM } from '../../core/params';
import { fontAscent } from '../font-metrics';
import { cssFont } from '../palette';
import type { FieldRenderer, SceneSnapshot } from '../renderer';
import type { ViewState } from '../view-state';
import { drawBall } from './ball-painter';
import { drawField } from './field-painter';
import { drawPlayers } from './player-painter';
import { QtPainter } from './qt-painter';
import { layoutViewport, Viewport } from './viewport';

export class Render2D implements FieldRenderer {
  readonly kind = '2d';
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly painter: QtPainter;
  private width = 0;
  private height = 0;
  private viewport: Viewport | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'field-layer';
    // Not { alpha: false }: Chrome may then draw text with subpixel
    // antialiasing, which depends on the system settings.
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
  }

  render(scene: SceneSnapshot | null, view: ViewState): void {
    const ascent = view.options.showScoreBoard ? fontAscent(cssFont(view.fonts.scoreBoard)) : 0;
    const vp = layoutViewport(view, this.width, this.height, ascent);
    this.viewport = vp;

    const p = this.painter;
    p.bounds = { width: this.width, height: this.height };
    const store = scene?.store;
    const sp = store?.serverParam ?? DEFAULT_SERVER_PARAM;
    drawField(p, vp, view, sp);
    if (!scene || !store) {
      return;
    }
    drawPlayers({ p, vp, view, sp, playerType: (id) => store.playerType(id) }, scene.frame);
    drawBall(p, vp, view, sp, scene.frame.ball);
  }

  screenToField(x: number, y: number): Vec2 | null {
    const vp = this.viewport;
    return vp ? { x: vp.fieldX(x), y: vp.fieldY(y) } : null;
  }

  fieldToScreen(x: number, y: number): Vec2 | null {
    const vp = this.viewport;
    return vp ? { x: vp.screenX(x), y: vp.screenY(y) } : null;
  }

  dispose(): void {
    this.canvas.remove();
  }
}

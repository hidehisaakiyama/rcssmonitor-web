// The field view: the renderer's canvas with the HUD on top, mouse
// operations and the redraw loop (rcssmonitor src/field_canvas.cpp). The
// renderer is the 2D one or the 3D one; the 2D mouse operations (dragging
// the field, the measuring tool, double click) apply to the 2D view only,
// and the 3D renderer handles the mouse for its camera.
import { PITCH, type Side } from '../core/constants';
import type { GameStore } from '../core/game-store';
import type { Vec2 } from '../core/geometry';
import { Hud } from '../view/hud/hud';
import type { Measure } from '../view/render2d/measure-painter';
import { Render2D } from '../view/render2d/render2d';
import type { FieldRenderer, SceneSnapshot } from '../view/renderer';
import type { ViewState } from '../view/view-state';

/** What a click on the field aims at, for the referee commands. */
export interface FieldTarget {
  /** The field point; null where there is none (3D: the sky, the ground far away). */
  readonly point: Vec2 | null;
  /** The player clicked on (3D); null: the one nearest to the point, if any. */
  readonly player: { readonly side: Side; readonly unum: number } | null;
}

/** In 3D, the ground beyond the pitch and its margin is too near the horizon to aim at. */
const withinMargin = (p: Vec2) =>
  Math.abs(p.x) <= PITCH.length / 2 + PITCH.margin &&
  Math.abs(p.y) <= PITCH.width / 2 + PITCH.margin;

/** Mouse button state (rcssmonitor src/mouse_state.h). */
class MouseState {
  pressed = false;
  pressedPoint: Vec2 = { x: 0, y: 0 };
  draggedPoint: Vec2 = { x: 0, y: 0 };

  press(p: Vec2): void {
    this.pressed = true;
    this.pressedPoint = p;
    this.draggedPoint = p;
  }

  release(): void {
    this.pressed = false;
  }

  move(p: Vec2): void {
    if (this.pressed) {
      this.draggedPoint = p;
    }
  }

  /** Pressed and moved more than 2 pixels. */
  get dragged(): boolean {
    return (
      this.pressed &&
      (Math.abs(this.pressedPoint.x - this.draggedPoint.x) > 2 ||
        Math.abs(this.pressedPoint.y - this.draggedPoint.y) > 2)
    );
  }
}

export class FieldView {
  readonly element: HTMLDivElement;
  /** The 2D renderer, kept while the 3D one is shown. */
  readonly render2d = new Render2D();
  private rendererValue: FieldRenderer = this.render2d;
  readonly hud = new Hud();
  private store: GameStore | null = null;
  private index = 0;
  private dirty = true;
  private drawnStoreRevision = -1;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private readonly focusMouse = new MouseState();
  private readonly measureMouse = new MouseState();
  private frameRequest = 0;
  private readonly resizeObserver: ResizeObserver;

  /** Called with the field coordinates under the mouse, or null when it leaves. */
  onPointerField: ((p: Vec2 | null) => void) | null = null;
  /** Called on every animation frame before drawing, with its timestamp. */
  onTick: ((now: number) => void) | null = null;
  /**
   * The frame and the fraction of the way to the next one for the 3D view,
   * which interpolates (the 2D view shows the frame index as it is).
   */
  position: (() => { index: number; alpha: number }) | null = null;
  /** True while the 3D view should be drawn on every frame (playing, live). */
  animate: (() => boolean) | null = null;

  constructor(readonly view: ViewState) {
    this.element = document.createElement('div');
    this.element.className = 'field-view';
    this.element.append(this.renderer.canvas, this.hud.canvas);

    view.onChange(() => this.invalidate());
    this.resizeObserver = new ResizeObserver(() => this.updateSize());
    this.resizeObserver.observe(this.element);
    this.attachMouse();
    this.frameRequest = requestAnimationFrame(this.tick);
  }

  get frameIndex(): number {
    return this.index;
  }

  get renderer(): FieldRenderer {
    return this.rendererValue;
  }

  /** Shows another renderer (2D / 3D); the game, the frame and the view settings stay. */
  setRenderer(renderer: FieldRenderer): void {
    const old = this.rendererValue;
    if (renderer === old) {
      return;
    }
    old.detach?.();
    old.onInvalidate = null;
    old.canvas.replaceWith(renderer.canvas);
    this.rendererValue = renderer;
    renderer.onInvalidate = () => this.invalidate();
    renderer.attach?.(this.element);
    this.focusMouse.release();
    this.measureMouse.release();
    // Size it for this view.
    this.width = 0;
    this.updateSize();
    this.invalidate();
  }

  get gameStore(): GameStore | null {
    return this.store;
  }

  /** The field coordinates at a point in the window, e.g. of a mouse event. */
  fieldAt(clientX: number, clientY: number): Vec2 {
    const r = this.element.getBoundingClientRect();
    return this.toField({ x: Math.round(clientX - r.left), y: Math.round(clientY - r.top) });
  }

  /**
   * What a click at a point in the window aims at. In 2D, the field point
   * under it. In 3D, a player whose body or head is under it (at its feet),
   * else the point where the camera's ray meets the ground, on the pitch or
   * its margin; nothing above the horizon.
   */
  targetAt(clientX: number, clientY: number): FieldTarget {
    const r = this.element.getBoundingClientRect();
    const p = { x: Math.round(clientX - r.left), y: Math.round(clientY - r.top) };
    const renderer = this.renderer;
    if (renderer.kind === '2d') {
      return { point: this.toField(p), player: null };
    }
    const player = renderer.playerAt?.(p.x, p.y) ?? null;
    if (player) {
      return {
        point: { x: player.x, y: player.y },
        player: { side: player.side, unum: player.unum },
      };
    }
    const ground = renderer.screenToField(p.x, p.y);
    return { point: ground && withinMargin(ground) ? ground : null, player: null };
  }

  setStore(store: GameStore | null): void {
    this.store = store;
    this.index = 0;
    this.invalidate();
  }

  setFrameIndex(index: number): void {
    const count = this.store?.frameCount ?? 0;
    const i = Math.max(0, Math.min(index, count - 1));
    if (i !== this.index) {
      this.index = i;
      this.invalidate();
    }
  }

  invalidate(): void {
    this.dirty = true;
  }

  /** Draws now instead of on the next animation frame. */
  renderNow(): void {
    this.updateSize();
    this.draw();
  }

  dispose(): void {
    cancelAnimationFrame(this.frameRequest);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.element.remove();
  }

  private readonly tick = (now: number) => {
    this.frameRequest = requestAnimationFrame(this.tick);
    this.onTick?.(now);
    const r = this.rendererValue;
    const moving = r.kind === '3d' && ((this.animate?.() ?? false) || (r.animating?.() ?? false));
    if (
      this.dirty ||
      moving ||
      (this.store !== null && this.store.revision !== this.drawnStoreRevision)
    ) {
      this.draw();
    }
  };

  private updateSize(): void {
    const rect = this.element.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    const dpr = window.devicePixelRatio || 1;
    if (width !== this.width || height !== this.height || dpr !== this.dpr) {
      this.width = width;
      this.height = height;
      this.dpr = dpr;
      this.renderer.resize(width, height, dpr);
      this.hud.resize(width, height, dpr);
      this.dirty = true;
    }
  }

  private scene(): SceneSnapshot | null {
    const store = this.store;
    if (!store || store.frameCount === 0) {
      return null;
    }
    const pos =
      this.rendererValue.kind === '3d' && this.position
        ? this.position()
        : { index: this.index, alpha: 0 };
    const i = Math.max(0, Math.min(pos.index, store.frameCount - 1));
    const frame = store.frame(i);
    if (!frame) {
      return null;
    }
    return { store, frameIndex: i, frame, next: store.frame(i + 1), alpha: pos.alpha };
  }

  private draw(): void {
    this.dirty = false;
    this.drawnStoreRevision = this.store?.revision ?? -1;
    if (this.width <= 0 || this.height <= 0) {
      return;
    }
    const scene = this.scene();
    if (scene) {
      this.view.updateForFrame(scene.frame);
    }
    this.renderer.render(scene, this.view);
    const measure: Measure | null = this.measureMouse.dragged
      ? { start: this.measureMouse.pressedPoint, end: this.measureMouse.draggedPoint }
      : null;
    const guide = this.renderer.guide?.() ?? null;
    this.hud.render(scene, this.view, measure, (x, y) => this.toField({ x, y }), guide);
  }

  private toField(p: Vec2): Vec2 {
    return this.renderer.screenToField(p.x, p.y) ?? { x: 0, y: 0 };
  }

  private attachMouse(): void {
    const el = this.element;
    const point = (e: MouseEvent): Vec2 => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) };
    };

    const is2d = () => this.rendererValue.kind === '2d';
    el.addEventListener('mousedown', (e) => {
      if (!is2d()) {
        return;
      }
      const p = point(e);
      if (e.button === 0 && !e.shiftKey) {
        this.focusMouse.press(p);
      } else if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        // Middle button, or Shift + left button for mice without one.
        e.preventDefault(); // no auto scroll
        this.measureMouse.press(p);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.focusMouse.release();
      }
      if (e.button === 0 || e.button === 1) {
        if (this.measureMouse.pressed) {
          this.measureMouse.release();
          this.invalidate();
        }
      }
      el.style.cursor = '';
    });

    window.addEventListener('mousemove', (e) => {
      const p = point(e);
      if (this.focusMouse.dragged) {
        el.style.cursor = 'grabbing';
        const vp = this.renderer.fieldToScreen(this.view.focusPoint.x, this.view.focusPoint.y);
        if (vp) {
          const nx = vp.x - (p.x - this.focusMouse.draggedPoint.x);
          const ny = vp.y - (p.y - this.focusMouse.draggedPoint.y);
          const f = this.toField({ x: nx, y: ny });
          this.view.setFocusPoint(f.x, f.y);
        }
      }
      this.focusMouse.move(p);
      this.measureMouse.move(p);
      if (this.measureMouse.dragged) {
        el.style.cursor = 'crosshair';
        this.invalidate();
      }
      const inside = p.x >= 0 && p.y >= 0 && p.x < this.width && p.y < this.height;
      // In 3D, null also above the horizon.
      this.onPointerField?.(inside ? this.renderer.screenToField(p.x, p.y) : null);
    });

    el.addEventListener('dblclick', (e) => {
      if (e.button === 0 && is2d()) {
        const f = this.toField(point(e));
        this.view.setFocusPoint(f.x, f.y);
      }
    });

    el.addEventListener('mouseleave', () => this.onPointerField?.(null));
  }
}

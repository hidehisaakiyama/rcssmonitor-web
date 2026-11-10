// The interface shared by the 2D renderer and the 3D renderer (Phase 6).
import type { Side } from '../core/constants';
import type { Frame } from '../core/frame';
import type { GameStore } from '../core/game-store';
import type { Vec2 } from '../core/geometry';
import type { CameraGuide } from './hud/guides';
import type { ViewState } from './view-state';

/** A player drawn under a canvas point, where it is drawn (field coordinates). */
export interface PlayerHit {
  readonly side: Side;
  readonly unum: number;
  readonly x: number;
  readonly y: number;
}

/** The game state to draw. */
export interface SceneSnapshot {
  readonly store: GameStore;
  readonly frameIndex: number;
  readonly frame: Frame;
  /** The frame after `frame`, for interpolation (3D). */
  readonly next?: Frame;
  /** Fraction of the way from `frame` to `next` (0-1). The 2D view ignores it. */
  readonly alpha: number;
}

export interface FieldRenderer {
  readonly kind: '2d' | '3d';
  readonly canvas: HTMLCanvasElement;
  /** Set by the view: the renderer asks to be drawn again (e.g. the 3D camera moved). */
  onInvalidate?: (() => void) | null;
  /** Takes the mouse on the element holding the canvas (3D camera). */
  attach?(element: HTMLElement): void;
  /** Stops taking the mouse. */
  detach?(): void;
  /** True while the renderer wants to be drawn on every frame (a camera moving). */
  animating?(): boolean;
  /** Size in CSS pixels and the device pixel ratio. */
  resize(width: number, height: number, dpr: number): void;
  /** Draws a scene, or only the field when no log is open. */
  render(scene: SceneSnapshot | null, view: ViewState): void;
  /** Field coordinates under a canvas point (CSS pixels), or null. */
  screenToField(x: number, y: number): Vec2 | null;
  /** Canvas point (CSS pixels) of field coordinates, or null. */
  fieldToScreen(x: number, y: number): Vec2 | null;
  /** The player drawn under a canvas point (CSS pixels), in front of the rest (3D). */
  playerAt?(x: number, y: number): PlayerHit | null;
  /** Where the 3D camera is, for the compass and the minimap; null: none to draw. */
  guide?(): CameraGuide | null;
  dispose(): void;
}

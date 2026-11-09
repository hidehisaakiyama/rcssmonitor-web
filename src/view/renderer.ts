// The interface shared by the 2D renderer and the 3D renderer (Phase 6).
import type { Frame } from '../core/frame';
import type { GameStore } from '../core/game-store';
import type { Vec2 } from '../core/geometry';
import type { ViewState } from './view-state';

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
  readonly canvas: HTMLCanvasElement;
  /** Size in CSS pixels and the device pixel ratio. */
  resize(width: number, height: number, dpr: number): void;
  /** Draws a scene, or only the field when no log is open. */
  render(scene: SceneSnapshot | null, view: ViewState): void;
  /** Field coordinates under a canvas point (CSS pixels), or null. */
  screenToField(x: number, y: number): Vec2 | null;
  /** Canvas point (CSS pixels) of field coordinates, or null. */
  fieldToScreen(x: number, y: number): Vec2 | null;
  dispose(): void;
}

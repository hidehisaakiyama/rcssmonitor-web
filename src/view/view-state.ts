// What to draw and how: display switches, player selection, focus and zoom.
// Shared by the 2D and 3D renderers (rcssmonitor src/options.cpp,
// src/config_dialog.cpp and FieldCanvas::updateFocus).
import { MAX_PLAYER, Side } from '../core/constants';
import { playerIndex, type Frame } from '../core/frame';
import { DEFAULT_FONTS, DEFAULT_PALETTE, type Fonts, type Palette } from './palette';

export interface ViewOptions {
  showScoreBoard: boolean;
  showTeamGraphic: boolean;
  showKeepawayArea: boolean;
  showFlag: boolean;
  showBall: boolean;
  showPlayer: boolean;
  showPlayerNumber: boolean;
  showPlayerType: boolean;
  showViewArea: boolean;
  showFocusPoint: boolean;
  showIllegalDefense: boolean;
  showCatchArea: boolean;
  showTackleArea: boolean;
  showKickAccelArea: boolean;
  showStamina: boolean;
  showStaminaCapacity: boolean;
  showPointto: boolean;
  showCard: boolean;
  showOffsideLine: boolean;
  showGridCoord: boolean;
  /** Fixed ball radius in meters; below 0.01 the real size is used. */
  ballSize: number;
  /** Fixed player radius in meters; below 0.01 the kickable area is used. */
  playerSize: number;
  /** Radius of the focus point mark in meters. */
  focusPointSize: number;
  /** Grid step in meters; 0 hides the grid. */
  gridStep: number;
  teamGraphicScale: number;
  /** Cycles of the predicted ball path; 0 hides it. */
  ballVelCycle: number;
}

export const DEFAULT_VIEW_OPTIONS: Readonly<ViewOptions> = Object.freeze({
  showScoreBoard: true,
  showTeamGraphic: true,
  showKeepawayArea: false,
  showFlag: false,
  showBall: true,
  showPlayer: true,
  showPlayerNumber: true,
  showPlayerType: false,
  showViewArea: false,
  showFocusPoint: false,
  showIllegalDefense: false,
  showCatchArea: false,
  showTackleArea: false,
  showKickAccelArea: false,
  showStamina: false,
  showStaminaCapacity: false,
  showPointto: false,
  showCard: true,
  showOffsideLine: false,
  showGridCoord: false,
  ballSize: 0.35,
  playerSize: 0.0,
  focusPointSize: 2.0,
  gridStep: 0.0,
  teamGraphicScale: 1.0,
  ballVelCycle: 0,
});

export type BooleanOption = {
  [K in keyof ViewOptions]: ViewOptions[K] extends boolean ? K : never;
}[keyof ViewOptions];

export type FocusType = 'ball' | 'player' | 'point';
export type SelectType = 'fix' | 'autoLeft' | 'autoRight' | 'autoAll' | 'unselect';

export interface PlayerRef {
  readonly side: Side;
  readonly unum: number;
}

export const MIN_FIELD_SCALE = 1.0;
export const MAX_FIELD_SCALE = 400.0;
export const ZOOM_RATIO = 1.5;

export class ViewState {
  readonly options: ViewOptions = { ...DEFAULT_VIEW_OPTIONS };
  readonly colors: Palette = { ...DEFAULT_PALETTE };
  readonly fonts: Fonts = structuredClone(DEFAULT_FONTS);

  focusType: FocusType = 'point';
  /** Field coordinates kept at the center of the view. */
  focusPoint = { x: 0, y: 0 };
  selected: PlayerRef | null = null;
  selectType: SelectType = 'unselect';

  /** Pixels per meter. While not zoomed, the layout overwrites it to fit the canvas. */
  fieldScale = 1.0;
  zoomed = false;

  private rev = 0;
  private readonly listeners = new Set<() => void>();

  /** Increases on every change. */
  get revision(): number {
    return this.rev;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Call after changing `options`, `colors` or `fonts` directly. */
  changed(): void {
    ++this.rev;
    for (const l of this.listeners) {
      l();
    }
  }

  toggle(name: BooleanOption): void {
    this.options[name] = !this.options[name];
    this.changed();
  }

  set<K extends keyof ViewOptions>(name: K, value: ViewOptions[K]): void {
    this.options[name] = value;
    this.changed();
  }

  isSelected(side: Side, unum: number): boolean {
    return this.selected !== null && this.selected.side === side && this.selected.unum === unum;
  }

  // ---- zoom (Options::zoomIn / zoomOut / fitToScreen / setFieldScale)

  zoomIn(): void {
    this.zoomed = true;
    this.fieldScale = Math.min(this.fieldScale * ZOOM_RATIO, MAX_FIELD_SCALE);
    this.changed();
  }

  zoomOut(): void {
    this.zoomed = true;
    this.fieldScale = Math.max(this.fieldScale / ZOOM_RATIO, MIN_FIELD_SCALE);
    this.changed();
  }

  setFieldScale(value: number): void {
    if (Math.abs(this.fieldScale - value) > 0.01) {
      this.fieldScale = Math.max(MIN_FIELD_SCALE, Math.min(value, MAX_FIELD_SCALE));
      this.zoomed = true;
      this.changed();
    }
  }

  /** Shows the whole field: no zoom, focus fixed at the center (I key). */
  fitToScreen(): void {
    this.focusType = 'point';
    this.focusPoint = { x: 0, y: 0 };
    this.zoomed = false;
    this.changed();
  }

  // ---- focus (ConfigDialog::toggleFocusBall etc.)

  /** Fixes the focus at a field point (double click, drag). */
  setFocusPoint(x: number, y: number): void {
    this.focusType = 'point';
    this.focusPoint = { x, y };
    this.changed();
  }

  setFocusFix(): void {
    if (this.focusType !== 'point') {
      this.focusType = 'point';
      this.changed();
    }
  }

  toggleFocusBall(): void {
    if (this.focusType === 'ball') {
      this.setFocusFix();
    } else {
      this.focusType = 'ball';
      this.changed();
    }
  }

  toggleFocusPlayer(): void {
    if (this.focusType === 'player') {
      this.setFocusFix();
    } else {
      this.focusType = 'player';
      this.changed();
    }
  }

  // ---- player selection

  /**
   * Selects a player by number: 1-11 are the left team, 12-22 the right team
   * (ConfigDialog::selectPlayer). Other numbers unselect.
   */
  selectPlayer(number: number): void {
    if (!Number.isInteger(number) || number < 1 || number > 2 * MAX_PLAYER) {
      this.unselect();
      return;
    }
    this.selectType = 'fix';
    this.selected =
      number <= MAX_PLAYER
        ? { side: Side.Left, unum: number }
        : { side: Side.Right, unum: number - MAX_PLAYER };
    this.changed();
  }

  unselect(): void {
    this.selectType = 'unselect';
    this.selected = null;
    this.focusType = 'point';
    this.changed();
  }

  /** A, L, R keys: pressing the same key again unselects. */
  toggleAutoSelect(type: 'autoLeft' | 'autoRight' | 'autoAll'): void {
    if (this.selectType === type) {
      this.unselect();
    } else {
      this.selectType = type;
      this.changed();
    }
  }

  /**
   * Updates what depends on the frame shown (FieldCanvas::updateFocus): the
   * automatically selected player (the one nearest to the ball) and the focus
   * point when following the ball or the selected player. Does not notify
   * listeners; the caller is about to draw anyway.
   */
  updateForFrame(frame: Frame): void {
    if (
      this.selectType === 'autoLeft' ||
      this.selectType === 'autoRight' ||
      this.selectType === 'autoAll'
    ) {
      const first = this.selectType === 'autoRight' ? MAX_PLAYER : 0;
      const last = this.selectType === 'autoLeft' ? MAX_PLAYER : 2 * MAX_PLAYER;
      let best: PlayerRef | null = null;
      let minDist2 = 40000;
      for (let i = first; i < last; ++i) {
        const p = frame.players[i];
        if (p && p.state !== 0) {
          const d2 = (frame.ball.x - p.x) ** 2 + (frame.ball.y - p.y) ** 2;
          if (d2 < minDist2) {
            minDist2 = d2;
            best = { side: p.side, unum: p.unum };
          }
        }
      }
      if (best) {
        this.selected = best;
      }
    }

    if (this.focusType === 'ball') {
      this.focusPoint = { x: frame.ball.x, y: frame.ball.y };
    } else if (this.focusType === 'player' && this.selected) {
      const p = frame.players[playerIndex(this.selected.side, this.selected.unum)];
      if (p && p.state !== 0) {
        this.focusPoint = { x: p.x, y: p.y };
      }
    }
  }
}

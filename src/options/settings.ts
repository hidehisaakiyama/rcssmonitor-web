// Settings kept between sessions (rcssmonitor's ~/.rcssmonitor.conf:
// Options::readSettings / writeSettings) and set by URL parameters (its
// command line options: Options::parseCmdLine).
//
// The names are rcssmonitor's (show_player_number, field_brush, ...). URL
// parameters may also write them with '-' (show-player-number=on), as on
// rcssmonitor's command line. Values given in the URL apply to the session;
// they are saved only if changed afterwards, so a shared link does not change
// the settings of whoever opens it.
import {
  DEFAULT_FONTS,
  DEFAULT_PALETTE,
  type FontSpec,
  type Fonts,
  type Palette,
} from '../view/palette';
import { CAMERA_MODES, type CameraMode } from '../view/render3d/cameras';
import {
  DEFAULT_PLAYER_CAMERA,
  PLAYER_CAMERA_DIRECTIONS,
  PLAYER_CAMERA_FOVS,
  PLAYER_CAMERA_MOTIONS,
  PLAYER_CAMERA_POSITIONS,
  PLAYER_SIGHTS,
  type PlayerCameraDirection,
  type PlayerCameraFov,
  type PlayerCameraMotion,
  type PlayerCameraOptions,
  type PlayerCameraPosition,
  type PlayerSight,
} from '../view/render3d/player-camera';
import { DEFAULT_VIEW_OPTIONS, type ViewOptions } from '../view/view-state';
import { readSetting, writeSetting } from './storage';

/** Settings outside the view: the window and the log player. */
export interface AppSettings {
  showMenuBar: boolean;
  showToolBar: boolean;
  showStatusBar: boolean;
  /** Default milliseconds per frame (rcssmonitor's timer_interval). */
  timerInterval: number;
  /** Loop playback (auto_loop_mode). */
  autoLoop: boolean;
  /** Fixed size of the field in CSS pixels; 0 fits the window. */
  canvasWidth: number;
  canvasHeight: number;
  /** The 3D view instead of the 2D one (not in rcssmonitor). */
  view3d: boolean;
  /** The camera of the 3D view. */
  camera3d: CameraMode;
  /** The styles of the selected player's camera (player-camera.ts). */
  playerCameraPosition: PlayerCameraPosition;
  playerCameraDirection: PlayerCameraDirection;
  playerCameraMotion: PlayerCameraMotion;
  playerCameraFov: PlayerCameraFov;
  playerCameraSight: PlayerSight;
  playerCameraTimeConstant: number;
  playerCameraMaxTurn: number;
  playerCameraFixedFov: number;
}

export const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = Object.freeze({
  showMenuBar: true,
  showToolBar: true,
  showStatusBar: true,
  timerInterval: 100,
  autoLoop: false,
  canvasWidth: 0,
  canvasHeight: 0,
  view3d: false,
  camera3d: 'broadcast',
  playerCameraPosition: DEFAULT_PLAYER_CAMERA.position,
  playerCameraDirection: DEFAULT_PLAYER_CAMERA.direction,
  playerCameraMotion: DEFAULT_PLAYER_CAMERA.motion,
  playerCameraFov: DEFAULT_PLAYER_CAMERA.fov,
  playerCameraSight: DEFAULT_PLAYER_CAMERA.sight,
  playerCameraTimeConstant: DEFAULT_PLAYER_CAMERA.timeConstant,
  playerCameraMaxTurn: DEFAULT_PLAYER_CAMERA.maxTurn,
  playerCameraFixedFov: DEFAULT_PLAYER_CAMERA.fixedFov,
});

/** The player camera's settings, for the 3D renderer. */
export function playerCameraOptions(app: AppSettings): PlayerCameraOptions {
  return {
    position: app.playerCameraPosition,
    direction: app.playerCameraDirection,
    motion: app.playerCameraMotion,
    fov: app.playerCameraFov,
    sight: app.playerCameraSight,
    timeConstant: app.playerCameraTimeConstant,
    maxTurn: app.playerCameraMaxTurn,
    fixedFov: app.playerCameraFixedFov,
  };
}

const PLAYER_CAMERA_KEYS = [
  'playerCameraPosition',
  'playerCameraDirection',
  'playerCameraMotion',
  'playerCameraFov',
  'playerCameraSight',
  'playerCameraTimeConstant',
  'playerCameraMaxTurn',
  'playerCameraFixedFov',
] as const satisfies readonly (keyof AppSettings)[];

/** The player camera's settings back to the defaults. */
export function resetPlayerCamera(app: AppSettings): void {
  for (const key of PLAYER_CAMERA_KEYS) {
    Object.assign(app, { [key]: DEFAULT_APP_SETTINGS[key] });
  }
}

/** What the settings apply to. */
export interface SettingTargets {
  readonly options: ViewOptions;
  readonly colors: Palette;
  readonly fonts: Fonts;
  readonly app: AppSettings;
}

export type SettingValue = boolean | number | string | FontSpec;

type NumberRange = { readonly min: number; readonly max: number; readonly integer?: boolean };

type Entry =
  | {
      readonly key: string;
      readonly kind: 'bool';
      readonly get: (t: SettingTargets) => boolean;
      readonly set: (t: SettingTargets, v: boolean) => void;
    }
  | ({
      readonly key: string;
      readonly kind: 'number';
      readonly get: (t: SettingTargets) => number;
      readonly set: (t: SettingTargets, v: number) => void;
    } & NumberRange)
  | {
      readonly key: string;
      readonly kind: 'choice';
      readonly values: readonly string[];
      readonly get: (t: SettingTargets) => string;
      readonly set: (t: SettingTargets, v: string) => void;
    }
  | { readonly key: string; readonly kind: 'color'; readonly name: keyof Palette }
  | { readonly key: string; readonly kind: 'font'; readonly name: keyof Fonts };

type BoolKey<T> = { [K in keyof T]: T[K] extends boolean ? K : never }[keyof T];
type NumberKey<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];

const viewBool = (key: string, name: BoolKey<ViewOptions>): Entry => ({
  key,
  kind: 'bool',
  get: (t) => t.options[name],
  set: (t, v) => {
    t.options[name] = v;
  },
});
const viewNumber = (key: string, name: NumberKey<ViewOptions>, range: NumberRange): Entry => ({
  key,
  kind: 'number',
  ...range,
  get: (t) => t.options[name],
  set: (t, v) => {
    t.options[name] = v;
  },
});
const appBool = (key: string, name: BoolKey<AppSettings>): Entry => ({
  key,
  kind: 'bool',
  get: (t) => t.app[name],
  set: (t, v) => {
    t.app[name] = v;
  },
});
const appNumber = (key: string, name: NumberKey<AppSettings>, range: NumberRange): Entry => ({
  key,
  kind: 'number',
  ...range,
  get: (t) => t.app[name],
  set: (t, v) => {
    t.app[name] = v;
  },
});
type ChoiceKey<T> = { [K in keyof T]: T[K] extends string ? K : never }[keyof T];
const appChoice = <K extends ChoiceKey<AppSettings>>(
  key: string,
  name: K,
  values: readonly AppSettings[K][],
): Entry => ({
  key,
  kind: 'choice',
  values,
  get: (t) => t.app[name],
  set: (t, v) => {
    Object.assign(t.app, { [name]: v });
  },
});
const color = (key: string, name: keyof Palette): Entry => ({ key, kind: 'color', name });
const font = (key: string, name: keyof Fonts): Entry => ({ key, kind: 'font', name });

/** Every setting, with rcssmonitor's name. */
export const SETTINGS: readonly Entry[] = [
  appBool('show_menu_bar', 'showMenuBar'),
  appBool('show_tool_bar', 'showToolBar'),
  appBool('show_status_bar', 'showStatusBar'),
  appNumber('timer_interval', 'timerInterval', { min: 5, max: 5000, integer: true }),
  appBool('auto_loop_mode', 'autoLoop'),
  appNumber('canvas_width', 'canvasWidth', { min: 0, max: 3000, integer: true }),
  appNumber('canvas_height', 'canvasHeight', { min: 0, max: 3000, integer: true }),
  // Not in rcssmonitor.
  appBool('view_3d', 'view3d'),
  appChoice('camera_3d', 'camera3d', CAMERA_MODES),
  appChoice('player_camera_position', 'playerCameraPosition', PLAYER_CAMERA_POSITIONS),
  appChoice('player_camera_direction', 'playerCameraDirection', PLAYER_CAMERA_DIRECTIONS),
  appChoice('player_camera_motion', 'playerCameraMotion', PLAYER_CAMERA_MOTIONS),
  appChoice('player_camera_fov', 'playerCameraFov', PLAYER_CAMERA_FOVS),
  appChoice('player_camera_sight', 'playerCameraSight', PLAYER_SIGHTS),
  appNumber('player_camera_time_constant', 'playerCameraTimeConstant', { min: 0, max: 5 }),
  appNumber('player_camera_max_turn', 'playerCameraMaxTurn', { min: 1, max: 3600 }),
  appNumber('player_camera_fixed_fov', 'playerCameraFixedFov', { min: 20, max: 120 }),

  viewBool('show_score_board', 'showScoreBoard'),
  viewBool('show_team_graphic', 'showTeamGraphic'),
  viewBool('show_keepaway_area', 'showKeepawayArea'),
  viewBool('show_flag', 'showFlag'),
  viewBool('show_ball', 'showBall'),
  viewBool('show_player', 'showPlayer'),
  viewBool('show_player_number', 'showPlayerNumber'),
  viewBool('show_player_type', 'showPlayerType'),
  viewBool('show_view_area', 'showViewArea'),
  viewBool('show_focus_point', 'showFocusPoint'),
  viewBool('show_illegal_defense', 'showIllegalDefense'),
  viewBool('show_catch_area', 'showCatchArea'),
  viewBool('show_tackle_area', 'showTackleArea'),
  viewBool('show_kick_accel_area', 'showKickAccelArea'),
  viewBool('show_stamina', 'showStamina'),
  viewBool('show_stamina_capacity', 'showStaminaCapacity'),
  viewBool('show_pointto', 'showPointto'),
  viewBool('show_card', 'showCard'),
  viewBool('show_offside_line', 'showOffsideLine'),
  viewBool('show_grid_coord', 'showGridCoord'),
  viewNumber('ball_size', 'ballSize', { min: 0, max: 100 }),
  viewNumber('player_size', 'playerSize', { min: 0, max: 100 }),
  viewNumber('focus_point_size', 'focusPointSize', { min: 0.1, max: 100 }),
  viewNumber('grid_step', 'gridStep', { min: 0, max: 100 }),
  viewNumber('team_graphic_scale', 'teamGraphicScale', { min: 0.01, max: 16 }),
  viewNumber('ball_vel_cycle', 'ballVelCycle', { min: 0, max: 50, integer: true }),

  color('field_brush', 'field'),
  color('line_pen', 'line'),
  color('measure_line_pen', 'measureLine'),
  color('measure_mark_pen', 'measureMark'),
  color('measure_font_pen', 'measureFont'),
  color('measure_font_pen2', 'measureFont2'),
  color('score_board_pen', 'scoreBoardPen'),
  color('score_board_brush', 'scoreBoardBrush'),
  color('ball_pen', 'ball'),
  color('ball_vel_pen', 'ballVel'),
  color('player_pen', 'playerPen'),
  color('left_team', 'leftTeam'),
  color('left_goalie', 'leftGoalie'),
  color('right_team', 'rightTeam'),
  color('right_goalie', 'rightGoalie'),
  color('player_number_pen', 'playerNumber'),
  color('player_number_inner_pen', 'playerNumberInner'),
  color('neck_pen', 'neck'),
  color('view_area_pen', 'viewArea'),
  color('large_view_area_pen', 'largeViewArea'),
  color('focus_point_pen', 'focusPoint'),
  color('ball_collide_brush', 'ballCollide'),
  // Not saved by rcssmonitor; named like the others.
  color('player_collide_brush', 'playerCollide'),
  color('effort_decayed_pen', 'effortDecayed'),
  color('recovery_decayed_pen', 'recoveryDecayed'),
  color('kick_pen', 'kick'),
  color('kick_fault_brush', 'kickFault'),
  color('kick_accel_pen', 'kickAccel'),
  color('catch_brush', 'catch'),
  color('catch_fault_brush', 'catchFault'),
  color('tackle_pen', 'tackle'),
  color('tackle_fault_brush', 'tackleFault'),
  color('foul_charged_brush', 'foulCharged'),
  color('pointto_pen', 'pointto'),
  color('illegal_defense_pen', 'illegalDefense'),

  font('score_board_font', 'scoreBoard'),
  font('player_font', 'player'),
  font('measure_font', 'measure'),
];

const BY_KEY = new Map(SETTINGS.map((e) => [e.key, e]));

/** Font sizes: points in the URL and rcssmonitor; Qt rounds them to whole pixels. */
export const pointsToPixels = (pt: number) => Math.round((pt * 4) / 3);
export const pixelsToPoints = (px: number) => Math.round((px * 3) / 4);

export function defaultTargets(): SettingTargets {
  return {
    options: { ...DEFAULT_VIEW_OPTIONS },
    colors: { ...DEFAULT_PALETTE },
    fonts: structuredClone(DEFAULT_FONTS),
    app: { ...DEFAULT_APP_SETTINGS },
  };
}

export function getSetting(t: SettingTargets, e: Entry): SettingValue {
  switch (e.kind) {
    case 'bool':
    case 'number':
    case 'choice':
      return e.get(t);
    case 'color':
      return t.colors[e.name];
    case 'font':
      return { ...t.fonts[e.name] };
  }
}

/** The current value of every setting, by name. */
export function snapshot(t: SettingTargets): Record<string, SettingValue> {
  return Object.fromEntries(SETTINGS.map((e) => [e.key, getSetting(t, e)]));
}

const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function isFont(v: unknown): v is FontSpec {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const f = v as Record<string, unknown>;
  return (
    typeof f['family'] === 'string' &&
    f['family'].trim() !== '' &&
    typeof f['size'] === 'number' &&
    Number.isInteger(f['size']) &&
    f['size'] >= 4 &&
    f['size'] <= 200 &&
    typeof f['bold'] === 'boolean'
  );
}

/** Sets one setting if the value is valid for it; returns whether it did. */
export function setSetting(t: SettingTargets, key: string, value: unknown): boolean {
  const e = BY_KEY.get(key);
  if (!e) {
    return false;
  }
  switch (e.kind) {
    case 'bool':
      if (typeof value !== 'boolean') {
        return false;
      }
      e.set(t, value);
      return true;
    case 'number':
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < e.min ||
        value > e.max ||
        (e.integer === true && !Number.isInteger(value))
      ) {
        return false;
      }
      e.set(t, value);
      return true;
    case 'choice':
      if (typeof value !== 'string' || !e.values.includes(value)) {
        return false;
      }
      e.set(t, value);
      return true;
    case 'color':
      if (!isColor(value)) {
        return false;
      }
      t.colors[e.name] = value.toLowerCase();
      return true;
    case 'font':
      if (!isFont(value)) {
        return false;
      }
      t.fonts[e.name] = { family: value.family.trim(), size: value.size, bold: value.bold };
      return true;
  }
}

/** Applies the valid values; returns the names applied. */
export function applySettings(t: SettingTargets, values: Record<string, unknown>): string[] {
  return Object.entries(values)
    .filter(([key, value]) => setSetting(t, key, value))
    .map(([key]) => key);
}

function parseBool(s: string): boolean | undefined {
  const v = s.trim().toLowerCase();
  if (v === '' || v === '1' || v === 'on' || v === 'true' || v === 'yes') {
    return true;
  }
  if (v === '0' || v === 'off' || v === 'false' || v === 'no') {
    return false;
  }
  return undefined;
}

/** A URL parameter's text as the value of a setting, or undefined. */
export function parseSettingText(key: string, text: string): SettingValue | undefined {
  const e = BY_KEY.get(key);
  switch (e?.kind) {
    case undefined:
      return undefined;
    case 'bool':
      return parseBool(text);
    case 'number': {
      const n = Number(text.trim());
      return text.trim() !== '' && Number.isFinite(n) ? n : undefined;
    }
    case 'choice':
      return e.values.includes(text.trim()) ? text.trim() : undefined;
    case 'color': {
      const c = text.trim().replace(/^#?/, '#');
      return isColor(c) ? c.toLowerCase() : undefined;
    }
    case 'font': {
      // "family,points[,bold]" like QFont::toString().
      const [family = '', size = '', bold = ''] = text.split(',').map((s) => s.trim());
      const pt = Number(size);
      return family !== '' && pt > 0
        ? { family, size: pointsToPixels(pt), bold: bold.toLowerCase() === 'bold' }
        : undefined;
    }
  }
}

/** The settings in URL parameters, with '-' read as '_'. Unknown names are left out. */
export function settingsFromUrl(params: URLSearchParams): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {};
  for (const [name, text] of params) {
    const key = name.replace(/-/g, '_');
    const value = parseSettingText(key, text);
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

const STORAGE_KEY = 'settings';

/**
 * The saved settings, the URL overrides of this session, and saving. The
 * settings are applied to `targets` (the live ViewState and App objects).
 */
export class SettingsStore {
  /** The values the URL set and the user has not changed since. */
  private readonly fromUrl = new Map<string, SettingValue>();
  /** The saved values of the settings that the URL overrode. */
  private readonly savedBeforeUrl = new Map<string, SettingValue>();

  constructor(private readonly targets: SettingTargets) {}

  /** Applies the saved settings, then the URL parameters. Returns the names the URL set. */
  load(params: URLSearchParams = new URLSearchParams()): string[] {
    const saved = readSetting(STORAGE_KEY);
    if (typeof saved === 'object' && saved !== null) {
      applySettings(this.targets, saved as Record<string, unknown>);
    }
    const url = settingsFromUrl(params);
    for (const [key, value] of Object.entries(url)) {
      const e = BY_KEY.get(key);
      if (!e) {
        continue;
      }
      const before = getSetting(this.targets, e);
      if (setSetting(this.targets, key, value)) {
        this.savedBeforeUrl.set(key, before);
        this.fromUrl.set(key, getSetting(this.targets, e));
      }
    }
    return [...this.fromUrl.keys()];
  }

  /** The values to save: the current ones, except those still as the URL set them. */
  toSave(): Record<string, SettingValue> {
    const values = snapshot(this.targets);
    for (const [key, urlValue] of this.fromUrl) {
      if (sameValue(values[key], urlValue)) {
        const saved = this.savedBeforeUrl.get(key);
        if (saved !== undefined) {
          values[key] = saved;
        }
      } else {
        // Changed by the user: from now on it is a setting like the others.
        this.fromUrl.delete(key);
        this.savedBeforeUrl.delete(key);
      }
    }
    return values;
  }

  save(): void {
    writeSetting(STORAGE_KEY, this.toSave());
  }
}

function sameValue(a: SettingValue | undefined, b: SettingValue): boolean {
  if (typeof a === 'object' && typeof b === 'object') {
    return a.family === b.family && a.size === b.size && a.bold === b.bold;
  }
  return a === b;
}

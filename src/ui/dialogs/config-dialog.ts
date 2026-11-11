// The view configuration (rcssmonitor src/config_dialog.cpp) with the same
// tabs: Show, Canvas, Color and Font, and two tabs for the 3D view (not in
// rcssmonitor): 3D (the close-up cameras, the compass, the minimap, the boards and
// the banners, the players) and
// Player Camera (the selected player's camera and what it draws). Changes
// apply at once. The controls follow the view while open, e.g. when a key
// toggles an option.
//
// Left out: Anti Aliasing (the canvas always smooths) and Draw Info (only in
// binary v1 logs). The Color tab lists all 35 colors of the settings file;
// rcssmonitor's dialog lists 30.
import { MAX_PLAYER, Side } from '../../core/constants';
import {
  DEFAULT_APP_SETTINGS,
  pixelsToPoints,
  pointsToPixels,
  resetPlayerCamera,
  resetView3d,
  type AppSettings,
} from '../../options/settings';
import { DEFAULT_FONTS, DEFAULT_PALETTE, type Fonts, type Palette } from '../../view/palette';
import { BALL_AIDS } from '../../view/render3d/ball-aids';
import { CLOSEUP_RANGE } from '../../view/render3d/cameras';
import { DEFAULT_PLAYER_CAMERA } from '../../view/render3d/player-camera';
import {
  MAX_FIELD_SCALE,
  MIN_FIELD_SCALE,
  type BooleanOption,
  type FocusType,
  type SelectType,
  type ViewState,
} from '../../view/view-state';
import { el } from './dialog';
import { Panel } from './panel';

export interface ConfigHost {
  readonly view: ViewState;
  readonly app: AppSettings;
  /** Applies app.canvasWidth / canvasHeight. */
  applyCanvasSize(): void;
  /** Applies the settings of the 3D and Player Camera tabs (app.playerCamera..., compass3d, ...). */
  applyView3d(): void;
}

const SHOW: [BooleanOption, string][] = [
  ['showScoreBoard', 'Score Board'],
  ['showTeamGraphic', 'Team Graphic'],
  ['showKeepawayArea', 'Keepaway Area'],
  ['showFlag', 'Flag'],
  ['showBall', 'Ball'],
  ['showPlayer', 'Player'],
  ['showOffsideLine', 'Offside Line'],
];

const PLAYER_INFO: [BooleanOption, string][] = [
  ['showPlayerNumber', 'Unum'],
  ['showPlayerType', 'Type'],
  ['showCard', 'Card'],
  ['showIllegalDefense', 'Illegal Defense'],
  ['showStamina', 'Stamina'],
  ['showStaminaCapacity', 'Stamina Capacity'],
  ['showViewArea', 'View Area'],
  ['showFocusPoint', 'Focus Point'],
  ['showCatchArea', 'Catch Area'],
  ['showTackleArea', 'Tackle Area'],
  ['showKickAccelArea', 'Kick Accel Area'],
  ['showPointto', 'Pointto'],
];

/** In rcssmonitor's order, then the ones its dialog lacks. */
export const COLOR_LABELS: readonly [keyof Palette, string][] = [
  ['field', 'Field'],
  ['line', 'Line'],
  ['scoreBoardPen', 'Score Board Font'],
  ['scoreBoardBrush', 'Score Board Background'],
  ['ball', 'Ball'],
  ['ballVel', 'Ball Velocity'],
  ['playerPen', 'Player Pen'],
  ['leftTeam', 'Left Team'],
  ['leftGoalie', 'Left Goalie'],
  ['rightTeam', 'Right Team'],
  ['rightGoalie', 'Right Goalie'],
  ['playerNumber', 'Player Number'],
  ['neck', 'Neck'],
  ['viewArea', 'View Area'],
  ['largeViewArea', 'Large View Area'],
  ['focusPoint', 'Focus Point'],
  ['ballCollide', 'Ball Collision'],
  ['playerCollide', 'Player Collision'],
  ['effortDecayed', 'Effort Decayed'],
  ['recoveryDecayed', 'Recovery Decayed'],
  ['kick', 'Kick'],
  ['kickFault', 'Kick Fault'],
  ['kickAccel', 'Kick Acceleration'],
  ['catch', 'Catch'],
  ['catchFault', 'Catch Fault'],
  ['tackle', 'Tackle'],
  ['tackleFault', 'Tackle Fault'],
  ['foulCharged', 'Foul Charged'],
  ['pointto', 'Pointto'],
  ['illegalDefense', 'Illegal Defense'],
  ['playerNumberInner', 'Player Number (Interior)'],
  ['measureLine', 'Measure Line'],
  ['measureMark', 'Measure Mark'],
  ['measureFont', 'Measure Font'],
  ['measureFont2', 'Measure Font 2'],
];

const FONT_LABELS: [keyof Fonts, string][] = [
  ['scoreBoard', 'Score Board'],
  ['player', 'Player'],
  ['measure', 'Measure'],
];

/** Font families offered in the list; any installed family can be typed. */
const FAMILIES = [
  'sans-serif',
  'serif',
  'monospace',
  'system-ui',
  'DejaVu Sans',
  'Arial',
  'Helvetica',
];

type Refresh = () => void;
/** A radio choice: [setting value, label, summary, tooltip (by default the summary)]. */
type Choice<T extends string> = readonly [T, string, string?, string?];

export class ConfigDialog {
  readonly panel: Panel;
  private readonly refreshers: Refresh[] = [];
  /** Colors when the dialog was opened, for Cancel. */
  private colorsAtOpen: Palette = { ...DEFAULT_PALETTE };

  constructor(
    parent: HTMLElement,
    private readonly host: ConfigHost,
  ) {
    this.panel = new Panel(parent, 'config-dialog', 'Preference');
    this.panel.dialog.classList.add('config-dialog');
    this.panel.onShow = () => {
      this.colorsAtOpen = { ...host.view.colors };
      this.refresh();
    };
    this.buildTabs();
    host.view.onChange(() => {
      if (this.panel.isOpen) {
        this.refresh();
      }
    });
  }

  private get view(): ViewState {
    return this.host.view;
  }

  /** Brings the controls up to date, except the one being edited. */
  refresh(): void {
    for (const r of this.refreshers) {
      r();
    }
  }

  // ---- layout

  private buildTabs(): void {
    const tabs: [string, HTMLElement][] = [
      ['Show', this.showTab()],
      ['Canvas', this.canvasTab()],
      ['Color', this.colorTab()],
      ['Font', this.fontTab()],
      ['3D', this.view3dTab()],
      ['Player Camera', this.playerCameraTab()],
    ];
    const bar = el('div', 'tab-bar');
    bar.setAttribute('role', 'tablist');
    const select = (i: number) => {
      tabs.forEach(([, page], k) => {
        page.hidden = k !== i;
        const b = bar.children[k] as HTMLButtonElement;
        b.setAttribute('aria-selected', String(k === i));
        b.tabIndex = k === i ? 0 : -1;
      });
    };
    tabs.forEach(([name, page], i) => {
      const b = el('button', 'tab', name);
      b.type = 'button';
      b.id = `config-tab-${name.toLowerCase().replace(/ /g, '-')}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', `${b.id}-page`);
      b.addEventListener('click', () => select(i));
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const n = tabs.length;
          const k = (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
          select(k);
          (bar.children[k] as HTMLElement).focus();
        }
      });
      page.id = `${b.id}-page`;
      page.className = 'tab-page';
      page.setAttribute('role', 'tabpanel');
      page.setAttribute('aria-labelledby', b.id);
      bar.append(b);
    });
    this.panel.body.append(bar, ...tabs.map(([, page]) => page));
    select(0);
  }

  private group(title: string, ...content: HTMLElement[]): HTMLElement {
    const f = el('fieldset', 'config-group');
    f.append(el('legend', '', title), ...content);
    return f;
  }

  private row(...content: (HTMLElement | string)[]): HTMLElement {
    const r = el('div', 'config-row');
    r.append(...content);
    return r;
  }

  private checkbox(id: string, label: string, get: () => boolean, set: (v: boolean) => void) {
    const wrap = el('label', 'config-check');
    const input = el('input');
    input.type = 'checkbox';
    input.id = id;
    input.addEventListener('change', () => set(input.checked));
    this.refreshers.push(() => {
      input.checked = get();
    });
    wrap.append(input, label);
    return wrap;
  }

  /** Radio buttons for choices, with their tooltips. */
  private radio<T extends string>(
    name: string,
    choices: readonly Choice<T>[],
    get: () => T,
    set: (v: T) => void,
  ): HTMLElement {
    const r = this.row();
    for (const [value, label, summary, details] of choices) {
      const wrap = el('label', 'config-check');
      const tooltip = details ?? summary;
      if (tooltip) {
        wrap.title = tooltip;
      }
      const input = el('input');
      input.type = 'radio';
      input.name = name;
      input.id = `${name}-${value}`;
      input.value = value;
      input.addEventListener('change', () => {
        if (input.checked) {
          set(value);
        }
      });
      this.refreshers.push(() => {
        input.checked = get() === value;
      });
      wrap.append(input, label);
      r.append(wrap);
    }
    return r;
  }

  /**
   * A number field applied on change (Enter or leaving it); refreshed unless
   * focused. While a value out of the range (or not a number) is typed, it
   * shows the error color. On change, with `clamp` the value is brought into
   * the range and applied (what is not a number goes back to the setting);
   * otherwise a value out of the range is not applied and keeps the color.
   */
  private number(
    id: string,
    get: () => number,
    set: (v: number) => void,
    range: { min: number; max: number; step: number },
    clamp = false,
  ): HTMLInputElement {
    const input = el('input', 'config-number');
    Object.assign(input, {
      type: 'number',
      id,
      min: String(range.min),
      max: String(range.max),
      step: String(range.step),
    });
    const value = () => {
      const v = Number(input.value);
      return input.value !== '' && Number.isFinite(v) ? v : null;
    };
    const inRange = (v: number) => v >= range.min && v <= range.max;
    input.addEventListener('input', () => {
      const v = value();
      input.classList.toggle('invalid', input.validity.badInput || (v !== null && !inRange(v)));
    });
    input.addEventListener('change', () => {
      const v = value();
      if (clamp) {
        const c = v === null ? get() : Math.min(range.max, Math.max(range.min, v));
        input.value = String(round(c));
        input.classList.remove('invalid');
        if (v !== null) {
          set(c);
        }
      } else if (v !== null && inRange(v)) {
        input.classList.remove('invalid');
        set(v);
      } else {
        input.classList.add('invalid');
      }
    });
    this.refreshers.push(() => {
      if (document.activeElement !== input) {
        input.value = String(round(get()));
        input.classList.remove('invalid');
      }
    });
    return input;
  }

  /** A slider with a number field beside it (scale, grid step). */
  private slider(
    id: string,
    get: () => number,
    set: (v: number) => void,
    range: { min: number; max: number; step: number },
  ): HTMLElement {
    const s = el('input', 'config-slider');
    Object.assign(s, {
      type: 'range',
      id: `${id}-slider`,
      min: String(range.min),
      max: String(range.max),
      step: String(range.step),
    });
    s.addEventListener('input', () => set(Number(s.value)));
    this.refreshers.push(() => {
      if (document.activeElement !== s) {
        s.value = String(get());
      }
    });
    return this.row(s, this.number(id, get, set, range));
  }

  private button(label: string, id: string, onClick: () => void, title = ''): HTMLButtonElement {
    const b = el('button', 'dialog-button', label);
    b.type = 'button';
    b.id = id;
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  // ---- Show

  private showTab(): HTMLElement {
    const page = el('div');
    const v = this.view;
    const checks = (items: [BooleanOption, string][]) => {
      const grid = el('div', 'config-checks');
      for (const [name, label] of items) {
        grid.append(
          this.checkbox(
            `config-${name}`,
            label,
            () => v.options[name],
            (on) => v.set(name, on),
          ),
        );
      }
      return grid;
    };

    const choice = el('select');
    choice.id = 'config-selected-player';
    choice.append(new Option('No Selection', '0'));
    for (const [side, name] of [
      [Side.Left, 'Left'],
      [Side.Right, 'Right'],
    ] as const) {
      for (let unum = 1; unum <= MAX_PLAYER; ++unum) {
        const n = side === Side.Left ? unum : unum + MAX_PLAYER;
        choice.append(new Option(`${name} number: ${unum}`, String(n)));
      }
    }
    choice.addEventListener('change', () => v.selectPlayer(Number(choice.value)));
    this.refreshers.push(() => {
      const s = v.selected;
      choice.value = s ? String(s.side === Side.Left ? s.unum : s.unum + MAX_PLAYER) : '0';
    });

    const selection: [SelectType, string][] = [
      ['autoAll', 'Auto'],
      ['autoLeft', 'Auto left'],
      ['autoRight', 'Auto right'],
      ['fix', 'Fix'],
      ['unselect', 'Unselect'],
    ];
    page.append(
      this.group('Show', checks(SHOW)),
      this.group('Player Info', checks(PLAYER_INFO)),
      this.group(
        'Player Selection',
        this.radio(
          'config-select',
          selection,
          () => v.selectType,
          (type) => {
            if (type === 'unselect') {
              v.unselect();
            } else if (type === 'fix') {
              // rcssmonitor sets Auto right here (config_dialog.cpp:2441).
              v.setSelectFix();
            } else if (v.selectType !== type) {
              v.toggleAutoSelect(type);
            }
          },
        ),
        this.row(choice),
      ),
      this.group(
        'Ball Info',
        this.row(
          'Velocity Cycles:',
          this.number(
            'config-ball-vel-cycle',
            () => v.options.ballVelCycle,
            (n) => v.set('ballVelCycle', Math.round(n)),
            {
              min: 0,
              max: 50,
              step: 1,
            },
          ),
        ),
      ),
    );
    return page;
  }

  // ---- Canvas

  private canvasTab(): HTMLElement {
    const page = el('div');
    const v = this.view;
    const app = this.host.app;

    const focus: [FocusType, string][] = [
      ['ball', 'Ball'],
      ['player', 'Selected Player'],
      ['point', 'Fix'],
    ];
    const width = this.number(
      'config-canvas-width',
      () => app.canvasWidth,
      () => {},
      {
        min: 0,
        max: 3000,
        step: 1,
      },
    );
    const height = this.number(
      'config-canvas-height',
      () => app.canvasHeight,
      () => {},
      {
        min: 0,
        max: 3000,
        step: 1,
      },
    );
    const applySize = (w: number, h: number) => {
      app.canvasWidth = w;
      app.canvasHeight = h;
      this.host.applyCanvasSize();
      this.refresh();
    };

    page.append(
      this.group(
        'Zoom',
        this.row(
          this.button('+', 'config-zoom-in', () => v.zoomIn(), 'Z'),
          this.button('-', 'config-zoom-out', () => v.zoomOut(), 'X'),
          this.button('Fit', 'config-fit', () => v.fitToScreen(), 'I'),
        ),
        this.row(
          'Scale:',
          this.slider(
            'config-scale',
            () => v.fieldScale,
            (s) => v.setFieldScale(s),
            {
              min: MIN_FIELD_SCALE,
              max: MAX_FIELD_SCALE,
              step: 0.1,
            },
          ),
        ),
      ),
      this.group(
        'Focus',
        this.radio(
          'config-focus',
          focus,
          () => v.focusType,
          (type) => {
            if (type === 'point') {
              v.setFocusFix();
            } else if (v.focusType !== type) {
              if (type === 'ball') {
                v.toggleFocusBall();
              } else {
                v.toggleFocusPlayer();
              }
            }
          },
        ),
      ),
      this.group(
        'Object Size',
        this.row(
          'Ball:',
          this.number(
            'config-ball-size',
            () => v.options.ballSize,
            (n) => v.set('ballSize', n),
            {
              min: 0,
              max: 100,
              step: 0.01,
            },
          ),
          'Player:',
          this.number(
            'config-player-size',
            () => v.options.playerSize,
            (n) => v.set('playerSize', n),
            {
              min: 0,
              max: 100,
              step: 0.01,
            },
          ),
          'Focus Point:',
          this.number(
            'config-focus-point-size',
            () => v.options.focusPointSize,
            (n) => v.set('focusPointSize', n),
            { min: 0.1, max: 100, step: 0.1 },
          ),
        ),
      ),
      this.group(
        'Canvas Size',
        this.row(
          'Width:',
          width,
          'Height:',
          height,
          this.button('apply', 'config-canvas-apply', () => {
            const w = Math.round(Number(width.value));
            const h = Math.round(Number(height.value));
            if (w >= 100 && h >= 100 && w <= 3000 && h <= 3000) {
              applySize(w, h);
            } else {
              width.classList.add('invalid');
              height.classList.add('invalid');
            }
          }),
          this.button('Fit window', 'config-canvas-fit', () => applySize(0, 0), 'Fill the window'),
        ),
        this.row(
          'Team Graphic Scale:',
          this.number(
            'config-team-graphic-scale',
            () => v.options.teamGraphicScale,
            (n) => v.set('teamGraphicScale', n),
            { min: 0.01, max: 16, step: 0.01 },
          ),
        ),
      ),
      this.group(
        'Grid Lines',
        this.checkbox(
          'config-showGridCoord',
          'Grid Coordinates',
          () => v.options.showGridCoord,
          (on) => v.set('showGridCoord', on),
        ),
        this.row(
          'Step:',
          this.slider(
            'config-grid-step',
            () => v.options.gridStep,
            (n) => v.set('gridStep', n),
            {
              min: 0,
              max: 100,
              step: 0.1,
            },
          ),
        ),
      ),
    );
    return page;
  }

  // ---- Color

  private colorTab(): HTMLElement {
    const page = el('div');
    const v = this.view;
    const list = el('ul', 'color-list');
    list.id = 'config-colors';
    for (const [name, label] of COLOR_LABELS) {
      const item = el('li');
      const wrap = el('label', 'color-item');
      const input = el('input', 'color-input');
      input.type = 'color';
      input.id = `config-color-${name}`;
      input.addEventListener('input', () => {
        v.colors[name] = input.value;
        v.changed();
      });
      this.refreshers.push(() => {
        input.value = v.colors[name];
      });
      wrap.append(input, label);
      item.append(wrap);
      list.append(item);
    }
    page.append(
      list,
      this.row(
        this.button(
          'Default',
          'config-color-default',
          () => {
            Object.assign(v.colors, DEFAULT_PALETTE);
            v.changed();
          },
          'Set the default colors',
        ),
        this.button(
          'Cancel',
          'config-color-cancel',
          () => {
            Object.assign(v.colors, this.colorsAtOpen);
            v.changed();
          },
          'Undo the color changes since the dialog was opened',
        ),
      ),
    );
    return page;
  }

  // ---- 3D and Player Camera
  //
  // Every item has a tooltip with the details; below a row of choices, a line
  // sums up the chosen one. The numbers the chosen styles do not use are dim.

  private note(text: string): HTMLElement {
    return el('p', 'panel-note config-hint', text);
  }

  private label(text: string, tooltip: string): HTMLLabelElement {
    const l = el('label', 'config-label', text);
    l.title = tooltip;
    return l;
  }

  /**
   * A row of choices (radio buttons `${id}-${value}`) after `label`, and
   * unless `summary` is false, the chosen one's summary below it.
   */
  private choice<T extends string>(
    id: string,
    label: string,
    tooltip: string,
    choices: readonly Choice<T>[],
    get: () => T,
    set: (v: T) => void,
    summary = true,
  ): HTMLElement[] {
    const row = this.radio(id, choices, get, (v) => {
      set(v);
      this.host.applyView3d();
      this.refresh();
    });
    row.classList.add('config-choice');
    if (label) {
      row.prepend(this.label(label, tooltip));
    }
    if (!summary) {
      return [row];
    }
    const hint = this.note('');
    hint.id = `${id}-hint`;
    hint.classList.toggle('indented', label !== '');
    this.refreshers.push(() => {
      hint.textContent = choices.find(([v]) => v === get())?.[2] ?? '';
    });
    return [row, hint];
  }

  private check3d(
    id: string,
    label: string,
    tooltip: string,
    get: () => boolean,
    set: (on: boolean) => void,
  ): HTMLElement {
    const c = this.checkbox(id, label, get, (on) => {
      set(on);
      this.host.applyView3d();
    });
    c.title = tooltip;
    return c;
  }

  /**
   * A number field after its label, dim while the chosen styles do not use
   * it. A value out of the range is brought into it; the tooltip tells the
   * range, in `unit`.
   */
  private number3d(
    id: string,
    label: string,
    tooltip: string,
    get: () => number,
    set: (v: number) => void,
    range: { min: number; max: number; step: number; unit: string },
    used: () => boolean,
  ): HTMLElement[] {
    const input = this.number(
      id,
      get,
      (v) => {
        set(v);
        this.host.applyView3d();
      },
      range,
      true,
    );
    const details =
      `${tooltip} Range: ${range.min}–${range.max}${range.unit}; ` +
      'a value outside it is brought to the nearest end.';
    input.title = details;
    const l = this.label(label, details);
    l.htmlFor = input.id;
    this.refreshers.push(() => {
      input.disabled = !used();
      l.classList.toggle('disabled', input.disabled);
    });
    return [l, input];
  }

  /**
   * The close-up cameras, and for every camera of the 3D view, the compass
   * and the minimap, the players, the boards and the banners.
   */
  private view3dTab(): HTMLElement {
    const page = el('div');
    const app = this.host.app;
    page.append(
      this.group(
        'Close-up Camera',
        this.row(
          ...this.number3d(
            'config-closeup-distance-3d',
            'Distance (m):',
            'How far the close-up cameras are from the ball or the player they follow, in ' +
              'meters. The wheel over the view changes it too.',
            () => app.closeupDistance3d,
            (v) => {
              app.closeupDistance3d = v;
            },
            { ...CLOSEUP_RANGE.distance, step: 0.5, unit: ' m' },
            () => true,
          ),
          ...this.number3d(
            'config-closeup-elevation-3d',
            'Elevation (°):',
            'How high the close-up cameras look down from, in degrees above the ground (the ' +
              'broadcast camera: 32°).',
            () => app.closeupElevation3d,
            (v) => {
              app.closeupElevation3d = v;
            },
            { ...CLOSEUP_RANGE.elevation, step: 1, unit: '°' },
            () => true,
          ),
        ),
        this.note(CLOSEUP_NOTE),
      ),
      this.group(
        'Guides',
        ...this.choice(
          'config-compass-3d',
          'Compass:',
          COMPASS_TOOLTIP,
          GUIDES,
          () => app.compass3d,
          (v) => {
            app.compass3d = v;
          },
          false,
        ),
        ...this.choice(
          'config-minimap-3d',
          'Minimap:',
          MINIMAP_TOOLTIP,
          GUIDES,
          () => app.minimap3d,
          (v) => {
            app.minimap3d = v;
          },
          false,
        ),
        this.note(GUIDES_NOTE),
      ),
      this.group(
        'Players',
        ...this.choice(
          'config-player-model-3d',
          'Model:',
          'How the players are drawn.',
          PLAYER_MODELS_3D,
          () => app.playerModel3d,
          (v) => {
            app.playerModel3d = v;
          },
        ),
        this.row(
          this.check3d(
            'config-shadows-3d',
            'Shadows',
            SHADOWS_TOOLTIP,
            () => app.shadows3d,
            (on) => {
              app.shadows3d = on;
            },
          ),
        ),
      ),
      this.group(
        'Ball',
        this.row(
          this.check3d(
            'config-ball-pattern-3d',
            'Pattern',
            BALL_PATTERN_TOOLTIP,
            () => app.ballPattern3d,
            (on) => {
              app.ballPattern3d = on;
            },
          ),
          this.check3d(
            'config-ball-ring-3d',
            'Ring',
            BALL_RING_TOOLTIP,
            () => app.ballRing3d,
            (on) => {
              app.ballRing3d = on;
            },
          ),
          this.check3d(
            'config-ball-trail-3d',
            'Trail',
            BALL_TRAIL_TOOLTIP,
            () => app.ballTrail3d,
            (on) => {
              app.ballTrail3d = on;
            },
          ),
        ),
        this.row(
          ...this.number3d(
            'config-ball-ring-radius-3d',
            'Ring Radius (m):',
            'The radius of the ring around the ball, in meters (by default the default ' +
              'kickable_margin).',
            () => app.ballRingRadius3d,
            (v) => {
              app.ballRingRadius3d = v;
            },
            { ...BALL_AIDS.ringRange, step: 0.1, unit: ' m' },
            () => app.ballRing3d,
          ),
          ...this.number3d(
            'config-ball-trail-cycles-3d',
            'Trail (cycles):',
            'How many cycles back the trail goes.',
            () => app.ballTrailCycles3d,
            (v) => {
              app.ballTrailCycles3d = Math.round(v);
            },
            { ...BALL_AIDS.trailRange, step: 1, unit: '' },
            () => app.ballTrail3d,
          ),
        ),
      ),
      this.group(
        'Stadium',
        this.row(
          this.check3d(
            'config-boards-3d',
            'Boards',
            BOARDS_TOOLTIP,
            () => app.boards3d,
            (on) => {
              app.boards3d = on;
            },
          ),
          this.check3d(
            'config-banners-3d',
            'Banners',
            BANNERS_TOOLTIP,
            () => app.banners3d,
            (on) => {
              app.banners3d = on;
            },
          ),
          this.check3d(
            'config-stands-3d',
            'Stands',
            STANDS_TOOLTIP,
            () => app.stands3d,
            (on) => {
              app.stands3d = on;
            },
          ),
        ),
        this.row(
          this.check3d(
            'config-grass-stripes-3d',
            'Grass Stripes',
            GRASS_STRIPES_TOOLTIP,
            () => app.grassStripes3d,
            (on) => {
              app.grassStripes3d = on;
            },
          ),
          this.check3d(
            'config-sky-3d',
            'Sky',
            SKY_TOOLTIP,
            () => app.sky3d,
            (on) => {
              app.sky3d = on;
            },
          ),
        ),
        this.note(STADIUM_NOTE),
      ),
      this.row(
        this.button(
          'Default',
          'config-3d-default',
          () => {
            resetView3d(app);
            this.host.applyView3d();
            this.refresh();
          },
          `Set the defaults: ${defaultView3d()}`,
        ),
      ),
    );
    return page;
  }

  /** The selected player's camera of the 3D view, in the styles to compare, and what it draws. */
  private playerCameraTab(): HTMLElement {
    const page = el('div');
    const app = this.host.app;
    const smooth = () => app.playerCameraMotion === 'smooth';
    page.append(
      this.note(PLAYER_CAMERA_NOTE),
      this.group(
        'Camera',
        ...this.choice(
          'config-player-camera-position',
          'Position:',
          'Where the camera is, along the camera direction',
          POSITIONS,
          () => app.playerCameraPosition,
          (v) => {
            app.playerCameraPosition = v;
          },
        ),
        ...this.choice(
          'config-player-camera-direction',
          'Direction:',
          'The goal direction that the camera turns to',
          DIRECTIONS,
          () => app.playerCameraDirection,
          (v) => {
            app.playerCameraDirection = v;
          },
        ),
        ...this.choice(
          'config-player-camera-motion',
          'Motion:',
          'How the camera turns to the goal direction',
          MOTIONS,
          () => app.playerCameraMotion,
          (v) => {
            app.playerCameraMotion = v;
          },
        ),
        ...this.choice(
          'config-player-camera-fov',
          'Field of View:',
          'The horizontal field of view h. The vertical one follows the shape of the canvas: ' +
            '2·atan(tan(h / 2) / (width / height)).',
          FOVS,
          () => app.playerCameraFov,
          (v) => {
            app.playerCameraFov = v;
          },
        ),
        this.row(
          ...this.number3d(
            'config-player-camera-time-constant',
            'Time Constant τ (s):',
            'τ of Smooth and Eased: after τ seconds, about 37% (1/e) of the difference is left ' +
              '(while Smooth turns slower than ω). With 0, Smooth turns at ω only and Eased ' +
              'follows at once. It applies with Enter or on leaving the field.',
            () => app.playerCameraTimeConstant,
            (v) => {
              app.playerCameraTimeConstant = v;
            },
            { min: 0, max: 5, step: 0.05, unit: ' s' },
            () => smooth() || app.playerCameraFov === 'eased',
          ),
          ...this.number3d(
            'config-player-camera-max-turn',
            'Max Turn ω (°/s):',
            'ω of Smooth: the fastest the camera turns, in degrees per second.',
            () => app.playerCameraMaxTurn,
            (v) => {
              app.playerCameraMaxTurn = v;
            },
            { min: 1, max: 3600, step: 1, unit: '°/s' },
            smooth,
          ),
        ),
        this.row(
          ...this.number3d(
            'config-player-camera-fixed-fov',
            'Fixed Field of View (°):',
            'The horizontal field of view of Fixed, in degrees.',
            () => app.playerCameraFixedFov,
            (v) => {
              app.playerCameraFixedFov = v;
            },
            { min: 20, max: 120, step: 1, unit: '°' },
            () => app.playerCameraFov === 'fixed',
          ),
        ),
      ),
      this.group(
        'Player Sight',
        ...this.choice(
          'config-player-camera-sight',
          '',
          '',
          SIGHTS,
          () => app.playerCameraSight,
          (v) => {
            app.playerCameraSight = v;
          },
        ),
        this.note(SIGHT_NOTE),
      ),
      this.row(
        this.button(
          'Default',
          'config-player-camera-default',
          () => {
            resetPlayerCamera(app);
            this.host.applyView3d();
            this.refresh();
          },
          `Set the default player camera: ${defaultPlayerCamera()}`,
        ),
      ),
    );
    return page;
  }

  // ---- Font

  private fontTab(): HTMLElement {
    const page = el('div');
    const v = this.view;
    const families = el('datalist');
    families.id = 'config-font-families';
    for (const f of FAMILIES) {
      families.append(new Option(f));
    }
    const table = el('div', 'font-table');
    table.append(
      el('span', 'font-head'),
      el('span', 'font-head', 'Family'),
      el('span', 'font-head', 'Size (pt)'),
      el('span', 'font-head', 'Bold'),
    );
    for (const [name, label] of FONT_LABELS) {
      const family = el('input', 'font-family');
      Object.assign(family, { type: 'text', id: `config-font-${name}-family`, spellcheck: false });
      family.setAttribute('list', families.id);
      family.addEventListener('change', () => {
        const f = family.value.trim();
        if (f !== '') {
          v.fonts[name].family = f;
          v.changed();
        }
      });
      const size = this.number(
        `config-font-${name}-size`,
        () => pixelsToPoints(v.fonts[name].size),
        (pt) => {
          v.fonts[name].size = pointsToPixels(pt);
          v.changed();
        },
        { min: 4, max: 144, step: 1 },
      );
      const bold = el('input');
      Object.assign(bold, { type: 'checkbox', id: `config-font-${name}-bold` });
      bold.addEventListener('change', () => {
        v.fonts[name].bold = bold.checked;
        v.changed();
      });
      this.refreshers.push(() => {
        if (document.activeElement !== family) {
          family.value = v.fonts[name].family;
        }
        bold.checked = v.fonts[name].bold;
      });
      const l = el('label', '', label);
      l.htmlFor = family.id;
      table.append(l, family, size, bold);
    }
    page.append(
      families,
      table,
      this.row(
        this.button(
          'Default',
          'config-font-default',
          () => {
            for (const [name] of FONT_LABELS) {
              Object.assign(v.fonts[name], DEFAULT_FONTS[name]);
            }
            v.changed();
          },
          'Set the default fonts',
        ),
      ),
    );
    return page;
  }
}

// The choices and notes of the 3D and Player Camera tabs: [value, label, the
// summary below the row, the tooltip (by default the summary)]. The details
// are in the tooltips (render3d/player-camera.ts and sight.ts compute them).
const POSITIONS: Choice<AppSettings['playerCameraPosition']>[] = [
  [
    'eye',
    'Eyes',
    'At the eyes, 1.65 m high; the player itself is not drawn.',
    'At the eyes, 1.65 m high, looking at the point 10 m ahead and 1 m high. ' +
      'The player itself is not drawn.',
  ],
  [
    'shoulder',
    'Over the Shoulder',
    '6 m behind the player and 3 m high.',
    '6 m behind the player and 3 m high, looking at the point 15 m ahead and 1 m high.',
  ],
];
const DIRECTIONS: Choice<AppSettings['playerCameraDirection']>[] = [
  [
    'head',
    'Head',
    'The face direction: body + neck.',
    'The goal is the face direction, body + neck: the center of the view cone.',
  ],
  [
    'body',
    'Body',
    'The body direction: not the neck.',
    'The goal is the body direction: the camera does not follow the neck.',
  ],
  [
    'middle',
    'Between',
    'Halfway: body + neck / 2.',
    'The goal is halfway between the body and the face: body + neck / 2.',
  ],
];
const MOTIONS: Choice<AppSettings['playerCameraMotion']>[] = [
  ['instant', 'Instant', 'The goal direction at every frame.'],
  [
    'smooth',
    'Smooth',
    'Turns by e·(1 − exp(−Δt / τ)) a frame, at most ω·Δt.',
    'Each frame, the camera turns by e·(1 − exp(−Δt / τ)), but at most ω·Δt: e is the angle ' +
      'left to the goal and Δt the time since the last frame (up to 0.1 s). So it turns at ω ' +
      'while e is over about ω·τ, and then slows down. It takes the goal at once when another ' +
      'player is selected, the player moves over 3 m in a frame (e.g. by a move), or the 3D ' +
      'camera or an option here changes.',
  ],
];
const FOVS: Choice<AppSettings['playerCameraFov']>[] = [
  [
    'view',
    'View Width',
    "The player's view width, within 40°–120°.",
    "The player's view width, within 40°–120°: the wide 180° is shown as 120°, " +
      'an unknown width as 90°.',
  ],
  [
    'eased',
    'Eased',
    'Toward the view width, by (1 − exp(−Δt / τ)) a frame.',
    'Each frame, the field of view moves (1 − exp(−Δt / τ)) of the way to the view width ' +
      '(as View Width; not limited by ω).',
  ],
  ['fixed', 'Fixed', 'Always Fixed Field of View, whatever the view width.'],
];
const SIGHTS: Choice<AppSettings['playerCameraSight']>[] = [
  [
    'all',
    'Everything',
    'Everything, as the other cameras draw it.',
    'Everything, as the other cameras draw it (the players not connected in black).',
  ],
  [
    'view',
    'View Cone',
    'Only the players and the ball in the view cone.',
    'Only the players and the ball in the view cone, at any distance: ' +
      '|the angle from the face direction| < the view width / 2.',
  ],
  [
    'server',
    'Server Rules',
    'As rcssserver tells the player: the numbers fade out from 20 m to 40 m, and those ' +
      'within 3 m out of the view are gray.',
    'As rcssserver tells the player. In the cone, the players up to ' +
      'player_max_observation_length (by default the diagonal of the pitch): the number has ' +
      'the opacity 1 − (d − unum_far_length) / (unum_too_far_length − unum_far_length) ' +
      'within 0–1, by default 1 under 20 m and 0 from 40 m, and without it the direction ' +
      'marks and the view area are not drawn. The team colors fade to gray in the same way ' +
      'by team_far_length and team_too_far_length. Outside the cone, the players within ' +
      'visible_distance (3 m) are drawn in gray only. The ball is drawn in the cone up to ' +
      'ball_max_observation_length, or within visible_distance. Unlike the server, the true ' +
      'distance is used every cycle, and the chances show as opacity and gray.',
  ],
];
const GUIDES: Choice<AppSettings['compass3d']>[] = [
  ['off', 'Off', 'Not shown.'],
  ['player', 'Player Camera', 'Shown with the Player camera only.'],
  ['all', 'All Cameras', 'Shown with every camera but Top, which is a map already.'],
];

const PLAYER_CAMERA_NOTE =
  "The 3D view's Player camera, at the selected player. Point at an item for details.";
const SIGHT_NOTE =
  'Only with a connected player selected, by its face direction and view width in the log.';
const COMPASS_TOOLTIP =
  'A strip at the top: the 360° around the camera direction (the triangle), with the ' +
  'directions of the goals (L, R in the team colors) and the ball, and what the camera sees ' +
  'brighter. Clockwise on the field is to the right.';
const MINIMAP_TOOLTIP =
  'The pitch at the bottom right as the 2D view shows it, with the players, the ball, and ' +
  'where the camera is and what it sees.';
const GUIDES_NOTE = 'Which way the camera looks; they show everything, whatever the Player Sight.';
const CLOSEUP_NOTE =
  'Close-up: Ball and Close-up: Selected Player (View > 3D Camera, E) follow from the near ' +
  'touch line as the broadcast camera does, but nearer; without a selected player, the ball.';
const PLAYER_MODELS_3D: Choice<AppSettings['playerModel3d']>[] = [
  ['simple', 'Simple', 'Cylinders and spheres.'],
  [
    'figure',
    'Figure',
    'Human figures (the CC0 Mannequin by Quaternius), 1.2 times life size: they walk and run ' +
      'by the speed, and kick, tackle, catch and point by the log. Cylinders from the top ' +
      'camera, and for players whose directions the player camera does not see.',
  ],
];
const SHADOWS_TOOLTIP =
  'The players and the goals cast shadows from the sun on the ground, except from the top ' +
  'camera. The ball keeps its shadow right below it, which tells its height.';
const BALL_RING_TOOLTIP =
  'A ring on the ground around the ball, to find it where it is small; its line stays at least ' +
  '2 pixels wide however far the camera is.';
const BALL_TRAIL_TOOLTIP =
  'A trail behind the ball like a contrail, along where it went in the last cycles, narrower ' +
  'and fainter the older; it breaks where the ball is placed.';
const BALL_PATTERN_TOOLTIP =
  'The ball with the twelve dark pentagons of a football, rolling along its path ' +
  '(at most a little under half a turn a cycle, so that a fast ball does not seem to turn back).';
const STANDS_TOOLTIP =
  'Stands along both touch lines, beyond the boards, with a crowd wearing more of the team ' +
  'color on its half. None behind the goals, where the banners float. They never hide the ' +
  'pitch from a camera in or behind them.';
const GRASS_STRIPES_TOOLTIP =
  'The grass mowed in stripes across the pitch, 5.25 m wide, lighter and darker than the field ' +
  'color (the Color tab).';
const SKY_TOOLTIP =
  'A sky from the pale horizon to the blue above, with a haze over the far ground.';
const BOARDS_TOOLTIP =
  'Boards around the pitch, 5.5 m out and 1 m high: a dark shade of the team color with the ' +
  'team name and edges in the team color, changing at the halfway line.';
const BANNERS_TOOLTIP =
  'A banner behind each goal, 22 m back and floating 12–20 m high, with the team name and ' +
  'logo: above the goal, so that the goal stands out against the sky and the ground beyond.';
const STADIUM_NOTE =
  'The boards, the banners and the crowd are in the team colors, to tell the ends apart; the ' +
  'goal nets always are. Point for details.';

const choiceLabel = <T extends string>(choices: readonly Choice<T>[], v: T) =>
  choices.find(([c]) => c === v)?.[1] ?? v;

/** The default player camera, for the Default button's tooltip. */
function defaultPlayerCamera(): string {
  const d = DEFAULT_PLAYER_CAMERA;
  return [
    choiceLabel(POSITIONS, d.position),
    choiceLabel(DIRECTIONS, d.direction),
    choiceLabel(MOTIONS, d.motion),
    choiceLabel(FOVS, d.fov),
    choiceLabel(SIGHTS, d.sight),
    `τ ${d.timeConstant} s`,
    `ω ${d.maxTurn}°/s`,
    `Fixed ${d.fixedFov}°`,
  ].join(', ');
}

/** The defaults of the 3D tab, for the Default button's tooltip. */
function defaultView3d(): string {
  const d = DEFAULT_APP_SETTINGS;
  return [
    `Close-up ${d.closeupDistance3d} m, ${d.closeupElevation3d}°`,
    `Compass ${choiceLabel(GUIDES, d.compass3d)}`,
    `Minimap ${choiceLabel(GUIDES, d.minimap3d)}`,
    `Boards ${d.boards3d ? 'On' : 'Off'}`,
    `Banners ${d.banners3d ? 'On' : 'Off'}`,
    `Model ${choiceLabel(PLAYER_MODELS_3D, d.playerModel3d)}`,
    `Shadows ${d.shadows3d ? 'On' : 'Off'}`,
    `Ball Pattern ${d.ballPattern3d ? 'On' : 'Off'}`,
    `Ball Ring ${d.ballRing3d ? `${d.ballRingRadius3d} m` : 'Off'}`,
    `Ball Trail ${d.ballTrail3d ? `${d.ballTrailCycles3d} cycles` : 'Off'}`,
    `Stands ${d.stands3d ? 'On' : 'Off'}`,
    `Grass Stripes ${d.grassStripes3d ? 'On' : 'Off'}`,
    `Sky ${d.sky3d ? 'On' : 'Off'}`,
  ].join(', ');
}

/** Up to 3 decimals, as rcssmonitor shows the scale and the sizes. */
function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

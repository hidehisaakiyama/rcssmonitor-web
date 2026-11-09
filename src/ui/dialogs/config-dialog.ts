// The view configuration (rcssmonitor src/config_dialog.cpp) with the same
// tabs: Show, Canvas, Color and Font. Changes apply at once. The controls
// follow the view while open, e.g. when a key toggles an option.
//
// Left out: Anti Aliasing (the canvas always smooths) and Draw Info (only in
// binary v1 logs). The Color tab lists all 35 colors of the settings file;
// rcssmonitor's dialog lists 30.
import { MAX_PLAYER, Side } from '../../core/constants';
import { pixelsToPoints, pointsToPixels, type AppSettings } from '../../options/settings';
import { DEFAULT_FONTS, DEFAULT_PALETTE, type Fonts, type Palette } from '../../view/palette';
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
      b.id = `config-tab-${name.toLowerCase()}`;
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

  private radio<T extends string>(
    name: string,
    choices: [T, string][],
    get: () => T,
    set: (v: T) => void,
  ): HTMLElement {
    const r = this.row();
    for (const [value, label] of choices) {
      const wrap = el('label', 'config-check');
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

  /** A number field applied on change (Enter or leaving it); refreshed unless focused. */
  private number(
    id: string,
    get: () => number,
    set: (v: number) => void,
    range: { min: number; max: number; step: number },
  ): HTMLInputElement {
    const input = el('input', 'config-number');
    Object.assign(input, {
      type: 'number',
      id,
      min: String(range.min),
      max: String(range.max),
      step: String(range.step),
    });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (input.value !== '' && Number.isFinite(v) && v >= range.min && v <= range.max) {
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

/** Up to 3 decimals, as rcssmonitor shows the scale and the sizes. */
function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

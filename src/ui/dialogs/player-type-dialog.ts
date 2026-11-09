// The player type list (rcssmonitor src/player_type_dialog.cpp): 16
// columns, sorted by any column with a click on its header.
//
// rcssmonitor sorts by the cell text read as a number, so the columns with
// two numbers ("1.050 / 1.050") do not sort; here they sort by the first.
// Changing the window opacity with the wheel is left out.
import type { GameStore } from '../../core/game-store';
import { el } from './dialog';
import { Panel } from './panel';

export const PLAYER_TYPE_COLUMNS: readonly string[] = [
  'id',
  'Size',
  'Speed Real/Max',
  'AccMax',
  'DashRate',
  'Decay',
  'IMoment',
  'Kickable',
  'KickMargin',
  'KickRate',
  'KickRand',
  'UnrelCatch',
  'StamInc',
  'ExtStam',
  'Eft Max-Min',
  'FoulProb',
];

const f = (v: number, digits = 6) => v.toFixed(digits);
const pair = (a: number, b: number, sep: string, pad = 0) =>
  `${f(a, 3).padStart(pad)}${sep}${f(b, 3).padStart(pad)}`;

/** The cells of each player type, sorted by id (PlayerTypeDialog::updateData). */
export function playerTypeRows(store: GameStore): string[][] {
  const sp = store.serverParam;
  return store.playerTypes.map((t) => {
    const accelMax = sp.maxpower * t.dash_power_rate * t.effort_max;
    const realSpeedMax = Math.min(accelMax / (1 - t.player_decay), t.player_speed_max);
    const halfWidth2 = (sp.catchable_area_w * 0.5) ** 2;
    const minCatch = Math.sqrt(
      halfWidth2 + (sp.catchable_area_l * (1 - (t.catchable_area_l_stretch - 1))) ** 2,
    );
    const maxCatch = Math.sqrt(
      halfWidth2 + (sp.catchable_area_l * t.catchable_area_l_stretch) ** 2,
    );
    return [
      String(t.id),
      f(t.player_size, 3),
      pair(realSpeedMax, t.player_speed_max, ' / ', 5),
      f(accelMax),
      f(t.dash_power_rate),
      f(t.player_decay),
      f(t.inertia_moment),
      f(t.player_size + t.kickable_margin + sp.ball_size),
      f(t.kickable_margin),
      f(t.kick_power_rate, 4),
      f(t.kick_rand),
      pair(minCatch, maxCatch, ' - '),
      f(t.stamina_inc_max, 4),
      f(t.extra_stamina, 4),
      pair(t.effort_max, t.effort_min, ' - '),
      f(t.foul_detect_probability, 3),
    ];
  });
}

/** Sorts rows by a column, by the first number in the cell. */
export function sortRows(rows: string[][], column: number, ascending: boolean): string[][] {
  const key = (row: string[]) => parseFloat(row[column] ?? '') || 0;
  return [...rows].sort((a, b) => (ascending ? 1 : -1) * (key(a) - key(b)));
}

export class PlayerTypeDialog {
  readonly panel: Panel;
  private readonly table: HTMLTableElement;
  private readonly headers: HTMLButtonElement[] = [];
  private sortColumn = 0;
  private ascending = true;

  constructor(
    parent: HTMLElement,
    private readonly store: () => GameStore | null,
  ) {
    this.panel = new Panel(parent, 'player-type-dialog', 'Player Type List');
    this.table = el('table', 'player-types');
    this.table.id = 'player-types';
    const head = el('tr');
    PLAYER_TYPE_COLUMNS.forEach((name, i) => {
      const th = el('th');
      th.scope = 'col';
      const b = el('button', 'sort-button', name);
      b.type = 'button';
      b.title = 'Sort by this column';
      b.addEventListener('click', () => {
        this.ascending = this.sortColumn === i ? !this.ascending : true;
        this.sortColumn = i;
        this.update();
      });
      th.append(b);
      head.append(th);
      this.headers.push(b);
    });
    this.table.createTHead().append(head);
    this.table.createTBody();
    const empty = el('p', 'panel-note', 'The player types arrive with the game.');
    empty.id = 'player-types-empty';
    this.panel.body.append(this.table, empty);
    this.panel.onShow = () => this.update();
  }

  /** Shows the types of the current game; call when the game changes. */
  update(): void {
    const store = this.store();
    const rows = store ? sortRows(playerTypeRows(store), this.sortColumn, this.ascending) : [];
    const body = this.table.tBodies[0];
    if (!body) {
      return;
    }
    body.replaceChildren(
      ...rows.map((cells) => {
        const tr = el('tr');
        for (const c of cells) {
          tr.append(el('td', '', c));
        }
        return tr;
      }),
    );
    this.headers.forEach((b, i) => {
      b.parentElement?.setAttribute(
        'aria-sort',
        i === this.sortColumn ? (this.ascending ? 'ascending' : 'descending') : 'none',
      );
    });
    const empty = this.panel.body.querySelector<HTMLElement>('#player-types-empty');
    if (empty) {
      empty.hidden = rows.length > 0;
    }
  }
}

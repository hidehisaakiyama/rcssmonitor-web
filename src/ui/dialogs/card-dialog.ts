// Yellow Card / Red Card: choose the player (rcssmonitor
// MainWindow::yellowCard / redCard, a list of "Left 1" ... "Right 11").
// The player under the right click is chosen beforehand.
import { MAX_PLAYER, Side } from '../../core/constants';
import type { Card } from '../../io/live/commands';
import { el, formDialog, row, runDialog } from './dialog';

export interface CardTarget {
  readonly side: Side;
  readonly unum: number;
}

export function showCardDialog(
  parent: HTMLElement,
  card: Card,
  teamNames: readonly [string, string],
  initial: CardTarget | null,
): Promise<CardTarget | null> {
  const title = card === 'yellow' ? 'Yellow Card' : 'Red Card';
  const d = formDialog('card-dialog', title, title);

  const select = el('select');
  select.id = 'card-player';
  select.required = true;
  select.append(new Option('', ''));
  for (const [side, name, team] of [
    [Side.Left, 'Left', teamNames[0]],
    [Side.Right, 'Right', teamNames[1]],
  ] as const) {
    const group = el('optgroup');
    group.label = team ? `${name}: ${team}` : name;
    for (let unum = 1; unum <= MAX_PLAYER; ++unum) {
      group.append(new Option(`${name} ${unum}`, `${side} ${unum}`));
    }
    select.append(group);
  }
  if (initial) {
    select.value = `${initial.side} ${initial.unum}`;
  }
  d.buttons.before(row('Player', select));

  const result = runDialog(parent, d, (): CardTarget | null => {
    const [side = 0, unum = 0] = select.value.split(' ').map(Number);
    return side === Side.Left || side === Side.Right ? { side, unum } : null;
  });
  select.focus();
  return result;
}

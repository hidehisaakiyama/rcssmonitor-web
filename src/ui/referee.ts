// Referee commands (rcssmonitor MainWindow::kickOff, dropBall,
// freeKickLeft / Right, yellowCard / redCard and changePlayMode) and the
// pop-up menu of the field (FieldCanvas::createPopupMenu and
// MainWindow::createFieldCanvas).
import { playModeToString, Side, sideToChar, type PlayMode } from '../core/constants';
import { isAlive, type Frame } from '../core/frame';
import type { Vec2 } from '../core/geometry';
import type { LiveClient } from '../io/live/client';
import {
  cardTargetError,
  CHANGE_PLAYMODE_MODES,
  changePlayModeCommands,
  DISP_START,
  dispCard,
  dispFoul,
  type Card,
} from '../io/live/commands';
import type { ActionItem, MenuItem } from './context-menu';
import { CTRL_LABEL } from './shortcuts';
import { showCardDialog, type CardTarget } from './dialogs/card-dialog';
import type { StatusBar } from './statusbar';

const NOT_CONNECTED = 'Connect to a server to use the referee commands.';
/** In 3D, a click above the horizon or far beyond the pitch. */
const NO_POINT = 'Right-click on the pitch or its margin to choose where.';
const NO_COACH_MODE =
  'The server is running without the coach mode (server::coach or server::coach_w_referee).';

/** The connected player nearest to `p` within `maxDist` meters, or null. */
export function nearestPlayer(frame: Frame, p: Vec2, maxDist = 3): CardTarget | null {
  let best: CardTarget | null = null;
  let bestDist = maxDist;
  for (const player of frame.players) {
    const d = Math.hypot(player.x - p.x, player.y - p.y);
    if (isAlive(player) && d <= bestDist) {
      best = { side: player.side, unum: player.unum };
      bestDist = d;
    }
  }
  return best;
}

const at = (p: Vec2) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`;

export class Referee {
  constructor(
    private readonly client: LiveClient,
    private readonly status: StatusBar,
    private readonly dialogParent: HTMLElement,
    /** The frame on the screen, for the team names and the player under the mouse. */
    private readonly currentFrame: () => Frame | undefined,
  ) {}

  get connected(): boolean {
    return this.client.connected;
  }

  /** change_mode and move (ball) need the coach mode on the server. */
  get coachMode(): boolean {
    const sp = this.client.store?.serverParam;
    return sp !== undefined && (sp.coach || sp.coach_w_referee);
  }

  kickOff(): void {
    if (this.client.send(DISP_START)) {
      this.status.showMessage('Kick off', 3000);
    }
  }

  dropBall(p: Vec2): void {
    if (this.client.send(dispFoul(p.x, p.y, Side.Neutral))) {
      this.status.showMessage(`Drop ball at ${at(p)}`, 1000);
    }
  }

  freeKick(side: Side, p: Vec2): void {
    if (this.client.send(dispFoul(p.x, p.y, side))) {
      const name = side === Side.Left ? 'left' : 'right';
      this.status.showMessage(`Free kick ${name} at ${at(p)}`, 1000);
    }
  }

  /** Asks for the player, with `initial` chosen, and sends the card. */
  async card(card: Card, initial: CardTarget | null): Promise<void> {
    if (!this.connected) {
      return;
    }
    const frame = this.currentFrame();
    const names = [frame?.teams[0].name ?? '', frame?.teams[1].name ?? ''] as const;
    const target = await showCardDialog(this.dialogParent, card, names, initial);
    if (!target) {
      return;
    }
    const error = cardTargetError(target.side, target.unum);
    if (error !== null) {
      this.status.showMessage(`The card was not sent: ${error}.`, 5000);
      return;
    }
    if (this.client.send(dispCard(target.side, target.unum, card))) {
      const name = card === 'yellow' ? 'Yellow' : 'Red';
      this.status.showMessage(`${name} card (${sideToChar(target.side)} ${target.unum})`, 5000);
    }
  }

  /** Moves the ball where the mode needs it, near `p`, and changes the mode. */
  changePlayMode(mode: PlayMode, p: Vec2): void {
    if (!this.connected) {
      return;
    }
    if (!this.coachMode) {
      this.status.showMessage(NO_COACH_MODE, 5000);
      return;
    }
    const commands = changePlayModeCommands(mode, p);
    if (!commands) {
      this.status.showMessage(`Unsupported play mode ${playModeToString(mode)}.`, 5000);
      return;
    }
    for (const c of commands) {
      this.client.send(c);
    }
    this.status.showMessage(`Change the play mode to ${playModeToString(mode)}`, 3000);
  }

  /**
   * The pop-up menu for a right click at `p` on the field, on `player` if
   * one was clicked (3D). Without a point (3D: above the horizon), the ball
   * cannot be placed, and Change Playmode starts from the ball as in the
   * Referee menu. The cards choose the player clicked, or the one near `p`.
   */
  menuItems(p: Vec2 | null, player: CardTarget | null = null): MenuItem[] {
    const frame = this.currentFrame();
    const near = player ?? (frame && p ? nearestPlayer(frame, p) : null);
    return [
      this.pointItem('menu-drop-ball', 'Drop Ball', p, (q) => this.dropBall(q)),
      this.pointItem('menu-free-kick-left', 'Free Kick Left', p, (q) =>
        this.freeKick(Side.Left, q),
      ),
      this.pointItem('menu-free-kick-right', 'Free Kick Right', p, (q) =>
        this.freeKick(Side.Right, q),
      ),
      { kind: 'separator' },
      ...this.cardItems(near, 'menu'),
      { kind: 'separator' },
      this.changePlayModeMenu(p ?? this.ball(), 'menu'),
    ];
  }

  /** The Referee menu of the menu bar (MainWindow::createMenuReferee). */
  menuBarItems(): MenuItem[] {
    // Without a point, Change Playmode starts from the ball (MainWindow::changePlayMode).
    const ball = this.ball();
    return [
      {
        ...this.item('referee-kick-off', 'KickOff', () => this.kickOff()),
        shortcut: `${CTRL_LABEL}K`,
      },
      { kind: 'separator' },
      ...this.cardItems(null, 'referee'),
      { kind: 'separator' },
      this.changePlayModeMenu(ball, 'referee'),
    ];
  }

  private ball(): Vec2 {
    return this.currentFrame()?.ball ?? { x: 0, y: 0 };
  }

  private item(id: string, label: string, action: () => void): ActionItem {
    const off = !this.connected;
    return { id, label, action, disabled: off, title: off ? NOT_CONNECTED : undefined };
  }

  /** An item that needs a point: disabled without one. */
  private pointItem(
    id: string,
    label: string,
    p: Vec2 | null,
    action: (p: Vec2) => void,
  ): ActionItem {
    if (p) {
      return this.item(id, label, () => action(p));
    }
    const title = this.connected ? NO_POINT : NOT_CONNECTED;
    return { id, label, action: () => {}, disabled: true, title };
  }

  private cardItems(initial: CardTarget | null, prefix: string): MenuItem[] {
    return [
      this.item(`${prefix}-yellow-card`, 'Yellow Card...', () => void this.card('yellow', initial)),
      this.item(`${prefix}-red-card`, 'Red Card...', () => void this.card('red', initial)),
    ];
  }

  private changePlayModeMenu(p: Vec2, prefix: string): MenuItem {
    const off = !this.connected;
    const noCoach = !off && !this.coachMode;
    return {
      kind: 'submenu',
      id: `${prefix}-change-playmode`,
      label: 'Change Playmode',
      disabled: off || noCoach,
      title: noCoach ? NO_COACH_MODE : off ? NOT_CONNECTED : undefined,
      items: CHANGE_PLAYMODE_MODES.map((mode) => {
        const name = playModeToString(mode);
        return {
          id: `${prefix}-playmode-${name}`,
          label: name,
          action: () => this.changePlayMode(mode, p),
        };
      }),
    };
  }
}

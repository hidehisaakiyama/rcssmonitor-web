// Keyboard shortcuts (rcssmonitor MainWindow::createActions and
// ConfigDialog), and the list shown by Help > Shortcut Keys. Ctrl is the
// Control key or Command on macOS. rcssmonitor uses Control on macOS (Qt's
// Meta), and so does this list: macOS keeps Command+H and Command+M for
// itself.
import type { Playback } from '../playback/playback';
import type { BooleanOption, ViewState } from '../view/view-state';

type Action = (view: ViewState) => void;

const toggle =
  (name: BooleanOption): Action =>
  (v) =>
    v.toggle(name);

/** Keys without Ctrl. */
const PLAIN: Readonly<Record<string, Action>> = {
  z: (v) => v.zoomIn(),
  x: (v) => v.zoomOut(),
  i: (v) => v.fitToScreen(),
  n: toggle('showPlayerNumber'),
  h: toggle('showPlayerType'),
  s: (v) => v.cycleStamina(),
  v: toggle('showViewArea'),
  c: toggle('showCatchArea'),
  t: toggle('showTackleArea'),
  k: toggle('showKickAccelArea'),
  o: toggle('showOffsideLine'),
  b: (v) => v.toggleFocusBall(),
  p: (v) => v.toggleFocusPlayer(),
  a: (v) => v.toggleAutoSelect('autoAll'),
  l: (v) => v.toggleAutoSelect('autoLeft'),
  r: (v) => v.toggleAutoSelect('autoRight'),
  u: (v) => v.unselect(),
  '-': (v) => v.selectPlayer(11),
  '0': (v) => v.selectPlayer(10),
};

/** Keys with Ctrl. */
const CTRL: Readonly<Record<string, Action>> = {
  z: (v) => v.zoomOut(),
  a: toggle('showPointto'),
  s: toggle('showScoreBoard'),
  b: toggle('showBall'),
  p: toggle('showPlayer'),
  f: toggle('showFlag'),
  '-': (v) => v.selectPlayer(22),
  '0': (v) => v.selectPlayer(21),
};

for (let i = 1; i <= 9; ++i) {
  (PLAIN as Record<string, Action>)[String(i)] = (v) => v.selectPlayer(i);
  (CTRL as Record<string, Action>)[String(i)] = (v) => v.selectPlayer(i + 11);
}

/**
 * Handles a key event for the view. Returns true if the key was used; the
 * caller should then prevent the browser's default action.
 */
export function handleViewKey(view: ViewState, e: KeyboardEvent): boolean {
  if (e.altKey) {
    return false;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl && e.shiftKey) {
    return false;
  }
  const action = (ctrl ? CTRL : PLAIN)[e.key.toLowerCase()];
  if (!action) {
    return false;
  }
  action(view);
  return true;
}

/**
 * Log player keys (rcssmonitor MainWindow::createActions): Space, arrows,
 * Home / End, G / Ctrl+G and Ctrl+Up / Down. Returns true if the key was
 * used.
 */
export function handlePlayerKey(playback: Playback, e: KeyboardEvent): boolean {
  if (e.altKey || e.shiftKey) {
    return false;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl) {
    switch (e.key) {
      case 'ArrowUp':
        playback.accelerate();
        return true;
      case 'ArrowDown':
        playback.decelerate();
        return true;
      case 'g':
      case 'G':
        playback.goToPreviousScore();
        return true;
      default:
        return false;
    }
  }
  switch (e.key) {
    case ' ':
      playback.togglePlay();
      return true;
    case 'ArrowLeft':
      playback.stepBackward();
      return true;
    case 'ArrowRight':
      playback.stepForward();
      return true;
    case 'Home':
      playback.goToFirst();
      return true;
    case 'End':
      playback.goToLast();
      return true;
    case 'g':
    case 'G':
      playback.goToNextScore();
      return true;
    default:
      return false;
  }
}

export interface MonitorKeyActions {
  connect(): void;
  live(): void;
  kickOff(): void;
}

/**
 * Monitor and referee keys (rcssmonitor MainWindow::createActionsMonitor,
 * createActionsLogPlayer and createActionsReferee): Ctrl+C connects,
 * Ctrl+L goes live and Ctrl+K kicks off. Ctrl+C is left to the browser
 * while text is selected, so that copying still works.
 */
export function handleMonitorKey(actions: MonitorKeyActions, e: KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) {
    return false;
  }
  switch (e.key.toLowerCase()) {
    case 'c':
      if (!(globalThis.document?.getSelection()?.isCollapsed ?? true)) {
        return false;
      }
      actions.connect();
      return true;
    case 'l':
      actions.live();
      return true;
    case 'k':
      actions.kickOff();
      return true;
    default:
      return false;
  }
}

export interface WindowKeyActions {
  open(): void;
  toggle3d(): void;
  nextCamera(): void;
  /**
   * I (the whole pitch) or Ctrl+I (the next viewpoint) of the 3D view;
   * false for I in 2D, where it fits the field instead (handleViewKey).
   */
  viewpoint(next: boolean): boolean;
  toggleMenuBar(): void;
  playerTypes(): void;
  preference(): void;
  fullScreen(): void;
}

/**
 * Window keys (rcssmonitor MainWindow::createActionsFile and
 * createActionsView): Ctrl+O, Ctrl+M (menu bar), Ctrl+H (player types),
 * Ctrl+V (preference), F11 and Alt+Enter (full screen).
 */
export function handleWindowKey(actions: WindowKeyActions, e: KeyboardEvent): boolean {
  const ctrl = e.ctrlKey || e.metaKey;
  // I, Ctrl+I: not in rcssmonitor (3D). Ctrl+Shift+I stays the browser's (the developer tools).
  if (e.key.toLowerCase() === 'i' && !e.altKey && !e.shiftKey) {
    return actions.viewpoint(ctrl);
  }
  if (e.shiftKey) {
    return false;
  }
  if (e.key === 'F11' && !ctrl && !e.altKey) {
    actions.fullScreen();
    return true;
  }
  if (e.key === 'Enter' && e.altKey && !ctrl) {
    actions.fullScreen();
    return true;
  }
  // D: not in rcssmonitor.
  if (e.key.toLowerCase() === 'd' && !ctrl && !e.altKey) {
    actions.toggle3d();
    return true;
  }
  if (e.key.toLowerCase() === 'e' && !ctrl && !e.altKey) {
    actions.nextCamera();
    return true;
  }
  if (!ctrl || e.altKey) {
    return false;
  }
  switch (e.key.toLowerCase()) {
    case 'o':
      actions.open();
      return true;
    case 'm':
      actions.toggleMenuBar();
      return true;
    case 'h':
      actions.playerTypes();
      return true;
    case 'v':
      actions.preference();
      return true;
    default:
      return false;
  }
}

// ---- the list of keys

export interface KeySpec {
  /** KeyboardEvent.key. */
  readonly key: string;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
}

export interface Shortcut {
  readonly group: string;
  readonly keys: readonly KeySpec[];
  readonly action: string;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** "Ctrl+" or "⌃" (Control) on macOS. */
export const CTRL_LABEL = isMac ? '⌃' : 'Ctrl+';

const KEY_NAMES: Readonly<Record<string, string>> = {
  ' ': 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};

export function keyLabel(k: KeySpec): string {
  const name = KEY_NAMES[k.key] ?? (k.key.length === 1 ? k.key.toUpperCase() : k.key);
  return `${k.ctrl ? CTRL_LABEL : ''}${k.alt ? 'Alt+' : ''}${name}`;
}

const key = (k: string): KeySpec => ({ key: k });
const ctrl = (k: string): KeySpec => ({ key: k, ctrl: true });
const digits = (withCtrl: boolean): KeySpec[] =>
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'].map((d) => ({ key: d, ctrl: withCtrl }));

/** Every key, with what it does (rcssmonitor's status tips). */
export const SHORTCUTS: readonly Shortcut[] = [
  { group: 'File', keys: [ctrl('o')], action: 'Open a game log file' },
  {
    group: 'Monitor',
    keys: [ctrl('c')],
    action: 'Connect to the last server (not while text is selected)',
  },
  { group: 'Monitor', keys: [ctrl('l')], action: 'Live mode: follow the newest frame' },
  { group: 'Referee', keys: [ctrl('k')], action: 'Send the kick-off command' },
  { group: 'Log player', keys: [key(' ')], action: 'Play or stop' },
  {
    group: 'Log player',
    keys: [key('ArrowLeft')],
    action: 'One step backward (also the wheel up)',
  },
  {
    group: 'Log player',
    keys: [key('ArrowRight')],
    action: 'One step forward (also the wheel down)',
  },
  { group: 'Log player', keys: [ctrl('ArrowDown')], action: 'Slower' },
  { group: 'Log player', keys: [ctrl('ArrowUp')], action: 'Faster' },
  { group: 'Log player', keys: [ctrl('g')], action: 'Go to the previous goal' },
  { group: 'Log player', keys: [key('g')], action: 'Go to the next goal' },
  { group: 'Log player', keys: [key('Home')], action: 'Go to the first frame' },
  { group: 'Log player', keys: [key('End')], action: 'Go to the last frame' },
  { group: 'Window', keys: [ctrl('m')], action: 'Show / hide the menu bar' },
  { group: 'Window', keys: [ctrl('h')], action: 'Player type list' },
  { group: 'Window', keys: [ctrl('v')], action: 'Preference (view configuration)' },
  { group: 'Window', keys: [key('F11'), { key: 'Enter', alt: true }], action: 'Full screen' },
  { group: 'Window', keys: [key('d')], action: 'Switch between the 2D and 3D views' },
  { group: 'Window', keys: [key('e')], action: 'The next camera of the 3D view' },
  { group: 'View', keys: [key('z')], action: 'Zoom in' },
  { group: 'View', keys: [key('x'), ctrl('z')], action: 'Zoom out' },
  {
    group: 'View',
    keys: [key('i')],
    action: 'Fit the field to the window; in 3D, the whole pitch from the side (free camera)',
  },
  {
    group: 'View',
    keys: [ctrl('i')],
    action: 'In 3D, the next viewpoint of the whole pitch (free camera)',
  },
  { group: 'View', keys: [key('b')], action: 'Follow the ball' },
  { group: 'View', keys: [key('p')], action: 'Follow the selected player' },
  { group: 'View', keys: [ctrl('s')], action: 'Show / hide the score board' },
  { group: 'View', keys: [ctrl('b')], action: 'Show / hide the ball' },
  { group: 'View', keys: [ctrl('p')], action: 'Show / hide the players' },
  { group: 'View', keys: [ctrl('f')], action: 'Show / hide the flags' },
  { group: 'View', keys: [key('o')], action: 'Show / hide the offside lines' },
  { group: 'Player info', keys: [key('n')], action: 'Show / hide the uniform numbers' },
  { group: 'Player info', keys: [key('h')], action: 'Show / hide the player types' },
  {
    group: 'Player info',
    keys: [key('s')],
    action: 'Show the stamina, its capacity, both or neither, in turn',
  },
  { group: 'Player info', keys: [key('v')], action: 'Show / hide the view areas' },
  { group: 'Player info', keys: [key('c')], action: 'Show / hide the catch areas' },
  { group: 'Player info', keys: [key('t')], action: 'Show / hide the tackle areas' },
  { group: 'Player info', keys: [key('k')], action: 'Show / hide the kick acceleration areas' },
  { group: 'Player info', keys: [ctrl('a')], action: 'Show / hide the pointto' },
  {
    group: 'Player selection',
    keys: digits(false),
    action: 'Select left player 1-9, 10 (0), 11 (-)',
  },
  {
    group: 'Player selection',
    keys: digits(true),
    action: 'Select right player 1-9, 10 (0), 11 (-)',
  },
  { group: 'Player selection', keys: [key('a')], action: 'Select the player nearest to the ball' },
  {
    group: 'Player selection',
    keys: [key('l')],
    action: 'Select the left player nearest to the ball',
  },
  {
    group: 'Player selection',
    keys: [key('r')],
    action: 'Select the right player nearest to the ball',
  },
  { group: 'Player selection', keys: [key('u')], action: 'Unselect the player' },
];

/** Mouse actions, also listed in Help > Shortcut Keys. */
export const MOUSE_ACTIONS: readonly [string, string][] = [
  ['Wheel', 'One step backward / forward'],
  ['Left drag', 'Move the field'],
  ['Double click', 'Center the field there'],
  ['Middle drag, Shift+left drag', 'Measure a distance'],
  ['Right click', 'Referee commands (while connected)'],
];

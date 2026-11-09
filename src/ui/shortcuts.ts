// Keyboard shortcuts (rcssmonitor MainWindow::createActions and
// ConfigDialog). Ctrl means Cmd on macOS, as in rcssmonitor's Meta.
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
  s: toggle('showStamina'),
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
      if (!(document.getSelection()?.isCollapsed ?? true)) {
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

// Keyboard shortcuts of the field view (rcssmonitor MainWindow::createActions
// and ConfigDialog). Ctrl means Cmd on macOS, as in rcssmonitor's Meta.
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

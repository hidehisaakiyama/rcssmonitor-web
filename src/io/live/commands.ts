// Commands from the monitor to rcssserver (rcssmonitor src/monitor_client.cpp)
// and the ball placement of a play mode change (src/main_window.cpp
// MainWindow::changePlayMode). The formats are in docs/protocol.md §6.
import { MAX_PLAYER, PITCH, PlayMode, playModeToString, Side } from '../../core/constants';
import { rint, type Vec2 } from '../../core/geometry';
import { formatG } from '../../core/number-format';

/** Positions in the disp* commands are in meters times this, rounded. */
export const SHOWINFO_SCALE = 16;

/** Longest message the server accepts, without the terminating NUL / CR / LF. */
export const MAX_COMMAND_LENGTH = 8191;

/** Asks for the JSON protocol. */
export const DISP_INIT = '(dispinit version -1)';
export const DISP_BYE = '(dispbye)';
/** Kick off at the start of each half. */
export const DISP_START = '(dispstart)';

/** Free kick for `side` at (x, y), or a drop ball when `side` is neutral. */
export function dispFoul(x: number, y: number, side: Side): string {
  // rint() may give -0, which prints as 0 like the C++ int.
  return `(dispfoul ${rint(x * SHOWINFO_SCALE)} ${rint(y * SHOWINFO_SCALE)} ${side})`;
}

export type Card = 'yellow' | 'red';

/**
 * Why a player cannot get a card, or null if it can. The server indexes its
 * player array with the uniform number unchecked (stadium.cpp:1131-1153), so
 * this must be checked before sending.
 */
export function cardTargetError(side: Side, unum: number): string | null {
  if (side !== Side.Left && side !== Side.Right) {
    return 'no team is selected';
  }
  if (!Number.isInteger(unum) || unum < 1 || unum > MAX_PLAYER) {
    return `illegal uniform number ${unum}`;
  }
  return null;
}

/** Throws a RangeError for a player that cardTargetError() rejects. */
export function dispCard(side: Side, unum: number, card: Card): string {
  const error = cardTargetError(side, unum);
  if (error !== null) {
    throw new RangeError(error);
  }
  return `(dispcard ${side} ${unum} ${card})`;
}

/** Needs the coach mode on the server. */
export function changeMode(mode: PlayMode): string {
  const name = playModeToString(mode);
  if (mode === PlayMode.Null || name === '') {
    throw new RangeError(`illegal play mode ${mode}`);
  }
  return `(change_mode ${name})`;
}

/**
 * Moves the ball and sets its velocity; needs the coach mode. The 0 is the
 * unused angle, which the server reads before the velocity (monitor.cpp
 * coach_move). Numbers are written like a C++ ostream.
 */
export function moveBall(x: number, y: number, vx = 0, vy = 0): string {
  return `(move (ball) ${formatG(x)} ${formatG(y)} 0 ${formatG(vx)} ${formatG(vy)})`;
}

/** The play modes offered by Change Playmode, in rcssmonitor's order. */
export const CHANGE_PLAYMODE_MODES: readonly PlayMode[] = [
  PlayMode.BeforeKickOff,
  PlayMode.PlayOn,
  PlayMode.KickInLeft,
  PlayMode.KickInRight,
  PlayMode.CornerKickLeft,
  PlayMode.CornerKickRight,
  PlayMode.GoalKickLeft,
  PlayMode.GoalKickRight,
  PlayMode.FoulChargeLeft,
  PlayMode.FoulChargeRight,
  PlayMode.BackPassLeft,
  PlayMode.BackPassRight,
  PlayMode.IndFreeKickLeft,
  PlayMode.IndFreeKickRight,
  PlayMode.IllegalDefenseLeft,
  PlayMode.IllegalDefenseRight,
];

/**
 * The commands that change the play mode with the ball at `point`, moved to
 * where the mode needs it; null for a mode that Change Playmode does not
 * offer. Unlike rcssmonitor, back_pass_l / _r are sent too (rcssmonitor
 * computes the position and then sends nothing).
 */
export function changePlayModeCommands(mode: PlayMode, point: Vec2): string[] | null {
  const halfLength = PITCH.length / 2;
  const halfWidth = PITCH.width / 2;
  const corner = PITCH.cornerArcRadius;
  const goalAreaX = halfLength - PITCH.goalAreaLength;
  const goalAreaY = PITCH.goalAreaWidth / 2;
  const penaltyAreaX = halfLength - PITCH.penaltyAreaLength;
  const penaltyAreaY = PITCH.penaltyAreaWidth / 2;

  let x = Math.min(Math.max(point.x, -halfLength), halfLength);
  let y = Math.min(Math.max(point.y, -halfWidth), halfWidth);

  switch (mode) {
    case PlayMode.BeforeKickOff:
      x = 0;
      y = 0;
      break;
    case PlayMode.PlayOn:
    case PlayMode.FoulChargeLeft:
    case PlayMode.FoulChargeRight:
      break;
    case PlayMode.KickInLeft:
    case PlayMode.KickInRight:
      y = y > 0 ? halfWidth : -halfWidth;
      break;
    case PlayMode.CornerKickLeft:
      x = halfLength - corner;
      y = y > 0 ? halfWidth - corner : -halfWidth + corner;
      break;
    case PlayMode.CornerKickRight:
      x = -halfLength + corner;
      y = y > 0 ? halfWidth - corner : -halfWidth + corner;
      break;
    case PlayMode.GoalKickLeft:
      x = -goalAreaX;
      y = y > 0 ? goalAreaY : -goalAreaY;
      break;
    case PlayMode.GoalKickRight:
      x = goalAreaX;
      y = y > 0 ? goalAreaY : -goalAreaY;
      break;
    case PlayMode.BackPassLeft:
      // Into the left penalty area.
      x = Math.min(x, -penaltyAreaX);
      if (Math.abs(y) > penaltyAreaY) {
        y = y > 0 ? penaltyAreaY : -penaltyAreaY;
      }
      break;
    case PlayMode.BackPassRight:
      x = Math.max(x, penaltyAreaX);
      if (Math.abs(y) > penaltyAreaY) {
        y = y > 0 ? penaltyAreaY : -penaltyAreaY;
      }
      break;
    case PlayMode.IndFreeKickLeft:
      // Out of the right goal area.
      if (x >= goalAreaX && Math.abs(y) <= goalAreaY) {
        x = goalAreaX;
      }
      break;
    case PlayMode.IndFreeKickRight:
      if (x <= -goalAreaX && Math.abs(y) <= goalAreaY) {
        x = -goalAreaX;
      }
      break;
    case PlayMode.IllegalDefenseLeft:
      x = -41.5;
      y = 0;
      break;
    case PlayMode.IllegalDefenseRight:
      x = 41.5;
      y = 0;
      break;
    default:
      return null;
  }
  return [moveBall(x, y, 0, 0), changeMode(mode)];
}

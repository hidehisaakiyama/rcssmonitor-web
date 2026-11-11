// How a player is colored by its state, shared by the 2D and 3D views
// (rcssmonitor PlayerPainter::drawBody): the outer circle's fill (brush) and
// outline (pen), the body darkened by the stamina, and the ring when effort
// or recovery has decayed.
import { Side } from '../core/constants';
import {
  isAlive,
  isCatching,
  isCatchingFault,
  isCollidedBall,
  isCollidedPlayer,
  isFoulCharged,
  isGoalie,
  isIllegalDefense,
  isKicking,
  isKickingFault,
  isTackling,
  isTacklingFault,
  type PlayerState,
} from '../core/frame';
import { rint } from '../core/geometry';
import type { PlayerType, ServerParam } from '../core/params';
import { darker, type Palette } from './palette';
import type { Pen } from './render2d/qt-painter';
import type { ViewOptions } from './view-state';

export interface PlayerStyle {
  /** The outer circle's outline; width 2 when highlighted. */
  readonly pen: Pen;
  /** The outer circle's fill: the team color, or a state color. */
  readonly brush: string;
  /** The body: the brush darkened as the stamina goes down. */
  readonly body: string;
  /** The ring around the circle when effort or recovery has decayed, or null. */
  readonly decay: string | null;
}

export function playerStyle(
  colors: Palette,
  options: ViewOptions,
  sp: ServerParam,
  type: PlayerType,
  player: PlayerState,
  selected: boolean,
): PlayerStyle {
  let pen: Pen = selected
    ? { color: colors.playerPen, width: 2 }
    : { color: colors.playerPen, width: 0 };
  let brush: string;
  if (player.side === Side.Left) {
    brush = isGoalie(player) ? colors.leftGoalie : colors.leftTeam;
  } else if (player.side === Side.Right) {
    brush = isGoalie(player) ? colors.rightGoalie : colors.rightTeam;
  } else {
    brush = '#000000';
  }

  if (!isAlive(player)) {
    brush = '#000000';
  }
  if (isIllegalDefense(player) && options.showIllegalDefense) {
    pen = { color: colors.illegalDefense, width: 2 };
  }
  if (isKicking(player)) {
    pen = { color: colors.kick, width: 2 };
  }
  if (isKickingFault(player)) {
    brush = colors.kickFault;
  }
  if (isCatching(player)) {
    brush = colors.catch;
  }
  if (isCatchingFault(player)) {
    brush = colors.catchFault;
  }
  if (isTackling(player)) {
    pen = { color: colors.tackle, width: 2 };
    brush = colors.tackle;
  }
  if (isTacklingFault(player)) {
    pen = { color: colors.tackle, width: 2 };
    brush = colors.tackleFault;
  }
  if (isFoulCharged(player)) {
    brush = colors.foulCharged;
  }
  if (isCollidedBall(player)) {
    brush = colors.ballCollide;
  }
  if (isCollidedPlayer(player)) {
    brush = colors.playerCollide;
  }

  // Darker by steps of 1/8 of the stamina.
  const staminaRate = player.stamina / sp.stamina_max;
  let darkRate = 200 - rint(200 * rint(staminaRate / 0.125) * 0.125);
  darkRate = Math.max(0, darkRate - 50);
  const body = darkRate === 0 ? brush : darker(brush, 100 + darkRate);

  let decay: string | null = null;
  if (Math.abs(type.effort_max - player.effort) >= 1.0e-5) {
    decay = colors.effortDecayed;
  } else if (Math.abs(1.0 - player.recovery) >= 1.0e-5) {
    decay = colors.recoveryDecayed;
  }
  return { pen, brush, body, decay };
}

// Game state at one simulation step, shared by the 2D and 3D renderers.
import { MAX_PLAYER, PlayerStateBit, Side, type PlayMode } from './constants';

export interface TeamInfo {
  /** Team name. Empty before the team connects ("null" on the wire). */
  readonly name: string;
  readonly score: number;
  /** Penalty shoot-out goals. 0 when the server did not send it. */
  readonly penScore: number;
  /** Penalty shoot-out misses. 0 when the server did not send it. */
  readonly penMiss: number;
}

export const EMPTY_TEAM: TeamInfo = Object.freeze({ name: '', score: 0, penScore: 0, penMiss: 0 });

export interface BallState {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

/** Command counters. Logs have them; the live protocol does not. */
export interface CommandCounts {
  readonly kick: number;
  readonly dash: number;
  readonly turn: number;
  readonly catch: number;
  readonly move: number;
  readonly turnNeck: number;
  readonly changeView: number;
  readonly say: number;
  readonly tackle: number;
  readonly pointto: number;
  readonly attentionto: number;
  /** Text logs before v6 do not have it. */
  readonly changeFocus?: number;
}

export interface PlayerState {
  readonly side: Side;
  readonly unum: number;
  /** Player type id. */
  readonly type: number;
  /** PlayerStateBit flags. 0 means the player is not connected. */
  readonly state: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  /** Body direction, absolute, in degrees. */
  readonly body: number;
  /** Neck direction relative to the body, in degrees. */
  readonly neck: number;
  /** Where the player points to (pointto), absolute coordinates. */
  readonly point?: { readonly x: number; readonly y: number };
  readonly viewQuality: 'h' | 'l';
  /** Full view width in degrees. */
  readonly viewWidth: number;
  /** Focus point: distance, and direction relative to body + neck (live protocol and text v6). */
  readonly focusPoint?: { readonly dist: number; readonly dir: number };
  readonly stamina: number;
  readonly effort: number;
  readonly recovery: number;
  /** Stamina capacity. Text v4 logs do not have it. */
  readonly capacity?: number;
  /** Target of attentionto. */
  readonly attention?: { readonly side: Side; readonly unum: number };
  readonly counts?: CommandCounts;
}

/** One show record without the play mode and the teams. */
export interface ShowData {
  readonly time: number;
  readonly stime: number;
  readonly ball: BallState;
  /** 22 players: left 1-11 at 0-10, right 1-11 at 11-21. */
  readonly players: readonly PlayerState[];
}

export interface Frame extends ShowData {
  readonly mode: PlayMode;
  readonly teams: readonly [TeamInfo, TeamInfo];
}

/** Index in Frame.players of a player. Returns -1 if out of range. */
export function playerIndex(side: Side, unum: number): number {
  if (!Number.isInteger(unum) || unum < 1 || unum > MAX_PLAYER) {
    return -1;
  }
  if (side === Side.Left) {
    return unum - 1;
  }
  if (side === Side.Right) {
    return MAX_PLAYER + unum - 1;
  }
  return -1;
}

/** A player slot that is not in the show: not connected, at the origin. */
export function disabledPlayer(index: number): PlayerState {
  const left = index < MAX_PLAYER;
  return {
    side: left ? Side.Left : Side.Right,
    unum: left ? index + 1 : index - MAX_PLAYER + 1,
    type: 0,
    state: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    body: 0,
    neck: 0,
    viewQuality: 'h',
    viewWidth: 0,
    stamina: 0,
    effort: 0,
    recovery: 0,
  };
}

// Predicates on the state bits (rcssmonitor rcss/rcg/types.h PlayerT).

export const isAlive = (p: PlayerState) => p.state !== 0;
export const isGoalie = (p: PlayerState) => (p.state & PlayerStateBit.Goalie) !== 0;
export const isKicking = (p: PlayerState) =>
  (p.state & PlayerStateBit.Kick) !== 0 && (p.state & PlayerStateBit.KickFault) === 0;
export const isKickingFault = (p: PlayerState) => (p.state & PlayerStateBit.KickFault) !== 0;
export const isCatching = (p: PlayerState) =>
  (p.state & PlayerStateBit.Catch) !== 0 && (p.state & PlayerStateBit.CatchFault) === 0;
export const isCatchingFault = (p: PlayerState) => (p.state & PlayerStateBit.CatchFault) !== 0;
export const isTackling = (p: PlayerState) =>
  (p.state & PlayerStateBit.Tackle) !== 0 && (p.state & PlayerStateBit.TackleFault) === 0;
export const isTacklingFault = (p: PlayerState) => (p.state & PlayerStateBit.TackleFault) !== 0;
export const isCollidedBall = (p: PlayerState) =>
  (p.state &
    (PlayerStateBit.BallCollide | PlayerStateBit.BallToPlayer | PlayerStateBit.PlayerToBall)) !==
  0;
export const isCollidedPlayer = (p: PlayerState) => (p.state & PlayerStateBit.PlayerCollide) !== 0;
export const isFoulCharged = (p: PlayerState) => (p.state & PlayerStateBit.FoulCharged) !== 0;
export const hasYellowCard = (p: PlayerState) => (p.state & PlayerStateBit.YellowCard) !== 0;
export const hasRedCard = (p: PlayerState) => (p.state & PlayerStateBit.RedCard) !== 0;
export const isIllegalDefense = (p: PlayerState) => (p.state & PlayerStateBit.IllegalDefense) !== 0;
export const isPointing = (p: PlayerState) => p.point !== undefined;
export const isFocusing = (p: PlayerState) => p.attention !== undefined;
/** Face (body + neck) direction in degrees. */
export const headDirection = (p: PlayerState) => p.body + p.neck;

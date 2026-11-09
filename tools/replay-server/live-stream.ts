// Game log records into the messages a live rcssserver sends with the JSON
// monitor protocol (docs/protocol.md §3): the parameters and player types
// first, then one show per step with the play mode and the teams in it.
// team_graphic and msg follow the show of their step; those before the
// first show follow the first show, as the server sends the logos after a
// show.
import { PlayMode, playModeToString, sideToChar } from '../../src/core/constants';
import { EMPTY_TEAM, type PlayerState, type ShowData, type TeamInfo } from '../../src/core/frame';
import type { RawParams } from '../../src/core/params';
import type { RcgRecord } from '../../src/core/records';

export interface LiveStep {
  readonly time: number;
  readonly stime: number;
  /** A show, then team_graphic / msg. */
  readonly messages: readonly string[];
}

export interface LiveStream {
  /** server_param, player_param and the player types. */
  readonly init: readonly string[];
  /** The server_param sent, or null if the log has none. */
  readonly serverParam: RawParams | null;
  readonly steps: readonly LiveStep[];
}

export interface LiveStreamOptions {
  /** Values to override in server_param, e.g. { coach: true }. */
  readonly serverParam?: RawParams;
}

export function liveStream(
  records: Iterable<RcgRecord>,
  options: LiveStreamOptions = {},
): LiveStream {
  const init: string[] = [];
  let serverParam: RawParams | null = null;
  const steps: { time: number; stime: number; messages: string[] }[] = [];
  // Messages before the first show.
  const beforeFirstShow: string[] = [];
  const afterShow = (message: string) =>
    (steps[steps.length - 1]?.messages ?? beforeFirstShow).push(message);
  let mode: PlayMode = PlayMode.Null;
  let teams: readonly [TeamInfo, TeamInfo] = [EMPTY_TEAM, EMPTY_TEAM];

  for (const r of records) {
    switch (r.type) {
      case 'serverParam':
        serverParam = { ...r.params, ...options.serverParam };
        init.push(JSON.stringify({ server_param: serverParam }));
        break;
      case 'playerParam':
        init.push(JSON.stringify({ player_param: r.params }));
        break;
      case 'playerType':
        init.push(JSON.stringify({ player_type: r.params }));
        break;
      case 'playMode':
        mode = r.mode;
        break;
      case 'team':
        teams = r.teams;
        break;
      case 'teamGraphic':
        afterShow(JSON.stringify({ team_graphic: { side: r.side, x: r.x, y: r.y, xpm: r.xpm } }));
        break;
      case 'msg':
        afterShow(
          JSON.stringify({
            msg: {
              time: r.time,
              ...(r.stime > 0 ? { stime: r.stime } : {}),
              board: r.board,
              message: r.message,
            },
          }),
        );
        break;
      case 'show':
        steps.push({
          time: r.show.time,
          stime: r.show.stime,
          messages: [
            showMessage(r.show, mode, teams),
            ...(steps.length === 0 ? beforeFirstShow : []),
          ],
        });
        break;
      case 'version':
      case 'timestamp':
        break;
    }
  }
  return { init, serverParam, steps };
}

/** A live show: with the play mode and the teams, without command counts. */
export function showMessage(
  show: ShowData,
  mode: PlayMode,
  teams: readonly [TeamInfo, TeamInfo],
): string {
  return JSON.stringify({
    show: {
      time: show.time,
      ...(show.stime > 0 ? { stime: show.stime } : {}),
      mode: playModeToString(mode),
      team: { l: team(teams[0]), r: team(teams[1]) },
      ball: show.ball,
      players: show.players.map(player),
    },
  });
}

function team(t: TeamInfo) {
  return {
    name: t.name === '' ? null : t.name,
    score: t.score,
    ...(t.penScore > 0 || t.penMiss > 0 ? { pen_score: t.penScore, pen_miss: t.penMiss } : {}),
  };
}

function player(p: PlayerState) {
  return {
    side: sideToChar(p.side),
    unum: p.unum,
    type: p.type,
    state: p.state,
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
    body: p.body,
    neck: p.neck,
    ...(p.point ? { px: p.point.x, py: p.point.y } : {}),
    vq: p.viewQuality,
    vw: p.viewWidth,
    ...(p.focusPoint ? { fdist: p.focusPoint.dist, fdir: p.focusPoint.dir } : {}),
    stamina: p.stamina,
    effort: p.effort,
    recovery: p.recovery,
    ...(p.capacity !== undefined ? { capacity: p.capacity } : {}),
    ...(p.attention ? { fside: sideToChar(p.attention.side), fnum: p.attention.unum } : {}),
  };
}

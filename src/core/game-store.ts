// Append-only store of a game: parameters, team logos and the frame list.
// Log loading and live reception feed it with the same records
// (rcssmonitor src/disp_holder.cpp).
import { PlayMode, Side } from './constants';
import { EMPTY_TEAM, type Frame, type TeamInfo } from './frame';
import {
  DEFAULT_PLAYER_PARAM,
  DEFAULT_PLAYER_TYPE,
  DEFAULT_SERVER_PARAM,
  makePlayerParam,
  makePlayerType,
  makeServerParam,
  type PlayerParam,
  type PlayerType,
  type ServerParam,
} from './params';
import type { RcgRecord } from './records';
import { TeamGraphic } from './team-graphic';

/** One kick of a penalty shoot-out. */
export interface PenaltyKick {
  /** Cycle of the penalty_score / penalty_miss play mode. */
  readonly time: number;
  /** Index of the first frame shown in that play mode. */
  readonly frameIndex: number;
  readonly scored: boolean;
}

export interface GameMessage {
  readonly time: number;
  readonly stime: number;
  /** 1: MSG_BOARD, 2: LOG_BOARD. */
  readonly board: number;
  readonly message: string;
  /** Index of the first frame after the message. */
  readonly frameIndex: number;
}

export class GameStore {
  /** Server version of a JSON log. Empty if unknown. */
  serverVersion = '';
  /** Time a JSON log was written. Empty if unknown. */
  timestamp = '';
  private serverParamValue: ServerParam = DEFAULT_SERVER_PARAM;
  private playerParamValue: PlayerParam = DEFAULT_PLAYER_PARAM;
  private readonly types = new Map<number, PlayerType>();
  readonly teamGraphics: readonly [TeamGraphic, TeamGraphic] = [
    new TeamGraphic(),
    new TeamGraphic(),
  ];
  /** Team graphic tiles rejected as malformed. */
  rejectedTiles = 0;

  private readonly frameList: Frame[] = [];
  private readonly scoreChangeList: number[] = [];
  private readonly penaltyLists: readonly [PenaltyKick[], PenaltyKick[]] = [[], []];
  private readonly messageList: GameMessage[] = [];

  // State applied to the next show.
  private mode: PlayMode = PlayMode.Null;
  private teams: readonly [TeamInfo, TeamInfo] = [EMPTY_TEAM, EMPTY_TEAM];

  private rev = 0;

  get serverParam(): ServerParam {
    return this.serverParamValue;
  }

  get playerParam(): PlayerParam {
    return this.playerParamValue;
  }

  /** Player types sorted by id. */
  get playerTypes(): PlayerType[] {
    return [...this.types.values()].sort((a, b) => a.id - b.id);
  }

  /** The player type with this id, or the default type if it is unknown. */
  playerType(id: number): PlayerType {
    return this.types.get(id) ?? DEFAULT_PLAYER_TYPE;
  }

  get frames(): readonly Frame[] {
    return this.frameList;
  }

  get frameCount(): number {
    return this.frameList.length;
  }

  frame(index: number): Frame | undefined {
    return this.frameList[index];
  }

  get lastFrame(): Frame | undefined {
    return this.frameList[this.frameList.length - 1];
  }

  /**
   * Indices of the frames whose score differs from the previous frame.
   * rcssmonitor records the frame before instead (the last frame with the old
   * score); jumps to a goal subtract a margin from these indices anyway.
   */
  get scoreChanges(): readonly number[] {
    return this.scoreChangeList;
  }

  /** Penalty shoot-out kicks of one side, in order. */
  penaltyKicks(side: Side): readonly PenaltyKick[] {
    return side === Side.Right ? this.penaltyLists[1] : this.penaltyLists[0];
  }

  get messages(): readonly GameMessage[] {
    return this.messageList;
  }

  /** Increases whenever the store changes. */
  get revision(): number {
    return this.rev;
  }

  /** Index of the first frame with time >= `time`, or -1 if there is none. */
  indexOfTime(time: number): number {
    const frames = this.frameList;
    let lo = 0;
    let hi = frames.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((frames[mid]?.time ?? Infinity) < time) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo < frames.length ? lo : -1;
  }

  applyAll(records: Iterable<RcgRecord>): void {
    for (const r of records) {
      this.apply(r);
    }
  }

  apply(r: RcgRecord): void {
    ++this.rev;
    switch (r.type) {
      case 'show': {
        const index = this.frameList.length;
        const prev = this.frameList[index - 1];
        const frame: Frame = { ...r.show, mode: this.mode, teams: this.teams };
        this.frameList.push(frame);
        if (
          prev &&
          (prev.teams[0].score !== frame.teams[0].score ||
            prev.teams[1].score !== frame.teams[1].score)
        ) {
          this.scoreChangeList.push(index);
        }
        break;
      }
      case 'playMode':
        if (r.mode !== this.mode) {
          this.recordPenalty(r.time, r.mode);
        }
        this.mode = r.mode;
        break;
      case 'team':
        this.teams = [
          sameTeam(this.teams[0], r.teams[0]) ? this.teams[0] : r.teams[0],
          sameTeam(this.teams[1], r.teams[1]) ? this.teams[1] : r.teams[1],
        ];
        break;
      case 'msg':
        this.messageList.push({
          time: r.time,
          stime: r.stime,
          board: r.board,
          message: r.message,
          frameIndex: this.frameList.length,
        });
        break;
      case 'teamGraphic': {
        const g = this.teamGraphics[r.side === 'l' ? 0 : 1];
        if (g.addTile(r.x, r.y, r.xpm) !== null) {
          ++this.rejectedTiles;
        }
        break;
      }
      case 'serverParam':
        this.serverParamValue = makeServerParam(r.params);
        break;
      case 'playerParam':
        this.playerParamValue = makePlayerParam(r.params);
        break;
      case 'playerType': {
        const t = makePlayerType(r.params);
        this.types.set(t.id, t);
        break;
      }
      case 'version':
        this.serverVersion = r.version;
        break;
      case 'timestamp':
        this.timestamp = r.timestamp;
        break;
    }
  }

  private recordPenalty(time: number, mode: PlayMode): void {
    const frameIndex = this.frameList.length;
    switch (mode) {
      case PlayMode.PenaltyScoreLeft:
      case PlayMode.PenaltyMissLeft:
        this.penaltyLists[0].push({
          time,
          frameIndex,
          scored: mode === PlayMode.PenaltyScoreLeft,
        });
        break;
      case PlayMode.PenaltyScoreRight:
      case PlayMode.PenaltyMissRight:
        this.penaltyLists[1].push({
          time,
          frameIndex,
          scored: mode === PlayMode.PenaltyScoreRight,
        });
        break;
    }
  }
}

function sameTeam(a: TeamInfo, b: TeamInfo): boolean {
  return (
    a.name === b.name && a.score === b.score && a.penScore === b.penScore && a.penMiss === b.penMiss
  );
}

// Records produced by the log parsers and by the live protocol, and consumed
// by GameStore.apply(). They are plain data so that a Worker can post them.
import type { PlayMode, SideChar } from './constants';
import type { ShowData, TeamInfo } from './frame';
import type { RawParams } from './params';

export type RcgRecord =
  /** Server version string of a JSON log (not the log format version). */
  | { readonly type: 'version'; readonly version: string }
  /** Time the JSON log was written, "%FT%T%z" (no colon in the offset). */
  | { readonly type: 'timestamp'; readonly timestamp: string }
  | { readonly type: 'serverParam'; readonly params: RawParams }
  | { readonly type: 'playerParam'; readonly params: RawParams }
  | { readonly type: 'playerType'; readonly params: RawParams }
  /** One 8x8 XPM tile of a team logo. */
  | {
      readonly type: 'teamGraphic';
      readonly side: SideChar;
      readonly x: number;
      readonly y: number;
      readonly xpm: readonly string[];
    }
  | {
      readonly type: 'playMode';
      readonly time: number;
      readonly stime: number;
      readonly mode: PlayMode;
    }
  | {
      readonly type: 'team';
      readonly time: number;
      readonly stime: number;
      readonly teams: readonly [TeamInfo, TeamInfo];
    }
  | {
      readonly type: 'msg';
      readonly time: number;
      readonly stime: number;
      readonly board: number;
      readonly message: string;
    }
  | { readonly type: 'show'; readonly show: ShowData };

export type RecordSink = (record: RcgRecord) => void;

import { describe, expect, it } from 'vitest';
import { PlayMode, Side } from '../../src/core/constants';
import { disabledPlayer, type TeamInfo } from '../../src/core/frame';
import { GameStore } from '../../src/core/game-store';
import type { RcgRecord } from '../../src/core/records';

const show = (time: number, stime = 0): RcgRecord => ({
  type: 'show',
  show: {
    time,
    stime,
    ball: { x: 0, y: 0, vx: 0, vy: 0 },
    players: Array.from({ length: 22 }, (_, i) => disabledPlayer(i)),
  },
});
const mode = (time: number, m: PlayMode): RcgRecord => ({
  type: 'playMode',
  time,
  stime: 0,
  mode: m,
});
const teamInfo = (name: string, score: number, penScore = 0, penMiss = 0): TeamInfo => ({
  name,
  score,
  penScore,
  penMiss,
});
const team = (time: number, l: TeamInfo, r: TeamInfo): RcgRecord => ({
  type: 'team',
  time,
  stime: 0,
  teams: [l, r],
});

describe('GameStore', () => {
  it('gives each frame the play mode and teams in effect', () => {
    const s = new GameStore();
    s.applyAll([
      mode(1, PlayMode.KickOffLeft),
      team(1, teamInfo('A', 0), teamInfo('B', 0)),
      show(1),
      mode(2, PlayMode.PlayOn),
      show(2),
      show(3),
    ]);
    expect(s.frameCount).toBe(3);
    expect(s.frames.map((f) => f.mode)).toEqual([
      PlayMode.KickOffLeft,
      PlayMode.PlayOn,
      PlayMode.PlayOn,
    ]);
    expect(s.frame(2)?.teams[0].name).toBe('A');
    // Unchanged teams are shared between frames.
    expect(s.frame(0)?.teams).toBe(s.frame(2)?.teams);
  });

  it('shares an equal team object when the same team record repeats', () => {
    const s = new GameStore();
    s.applyAll([team(1, teamInfo('A', 0), teamInfo('B', 0)), show(1)]);
    s.applyAll([team(2, teamInfo('A', 0), teamInfo('B', 1)), show(2)]);
    expect(s.frame(1)?.teams[0]).toBe(s.frame(0)?.teams[0]);
    expect(s.frame(1)?.teams[1]).not.toBe(s.frame(0)?.teams[1]);
  });

  it('records the frames where the score changes', () => {
    const s = new GameStore();
    s.applyAll([
      team(1, teamInfo('A', 0), teamInfo('B', 0)),
      show(1),
      show(2),
      mode(3, PlayMode.AfterGoalLeft),
      team(3, teamInfo('A', 1), teamInfo('B', 0)),
      show(3),
      show(4),
      team(5, teamInfo('A', 1), teamInfo('B', 1)),
      show(5),
      team(6, teamInfo('A', 1), teamInfo('B', 1)), // unchanged
      show(6),
    ]);
    expect(s.scoreChanges).toEqual([2, 4]);
  });

  it('does not count the first frame as a score change', () => {
    const s = new GameStore();
    s.applyAll([team(1, teamInfo('A', 2), teamInfo('B', 1)), show(100)]);
    expect(s.scoreChanges).toEqual([]);
  });

  it('records penalty kicks when the play mode changes', () => {
    const s = new GameStore();
    s.applyAll([
      mode(10, PlayMode.PenaltySetupLeft),
      show(10),
      mode(11, PlayMode.PenaltyScoreLeft),
      show(11),
      mode(12, PlayMode.PenaltyScoreLeft), // same mode again: not a new kick
      show(12),
      mode(13, PlayMode.PenaltySetupRight),
      show(13),
      mode(14, PlayMode.PenaltyMissRight),
      show(14),
    ]);
    expect(s.penaltyKicks(Side.Left)).toEqual([{ time: 11, frameIndex: 1, scored: true }]);
    expect(s.penaltyKicks(Side.Right)).toEqual([{ time: 14, frameIndex: 4, scored: false }]);
  });

  it('finds the first frame at or after a cycle', () => {
    const s = new GameStore();
    s.applyAll([show(1), show(2), show(2, 1), show(2, 2), show(5)]);
    expect(s.indexOfTime(0)).toBe(0);
    expect(s.indexOfTime(2)).toBe(1);
    expect(s.indexOfTime(3)).toBe(4);
    expect(s.indexOfTime(5)).toBe(4);
    expect(s.indexOfTime(6)).toBe(-1);
    expect(new GameStore().indexOfTime(1)).toBe(-1);
  });

  it('keeps parameters, player types, messages and team graphics', () => {
    const s = new GameStore();
    s.applyAll([
      { type: 'version', version: '19.0.0' },
      { type: 'serverParam', params: { half_time: 300 } },
      { type: 'playerParam', params: { player_types: 2 } },
      { type: 'playerType', params: { id: 1, player_size: 0.4 } },
      { type: 'playerType', params: { id: 0, player_size: 0.3 } },
      { type: 'msg', time: 0, stime: 0, board: 1, message: 'hello' },
      {
        type: 'teamGraphic',
        side: 'r',
        x: 0,
        y: 0,
        xpm: ['8 8 1 1', 'a c red', ...Array<string>(8).fill('aaaaaaaa')],
      },
      { type: 'teamGraphic', side: 'l', x: 0, y: 0, xpm: ['broken'] },
    ]);
    expect(s.serverVersion).toBe('19.0.0');
    expect(s.serverParam.half_time).toBe(300);
    expect(s.playerParam.player_types).toBe(2);
    expect(s.playerTypes.map((t) => t.id)).toEqual([0, 1]);
    expect(s.playerType(1).player_size).toBe(0.4);
    expect(s.playerType(99).id).toBe(0); // default type
    expect(s.messages).toEqual([{ time: 0, stime: 0, board: 1, message: 'hello', frameIndex: 0 }]);
    expect(s.teamGraphics[1].width).toBe(8);
    expect(s.teamGraphics[0].isEmpty()).toBe(true);
    expect(s.rejectedTiles).toBe(1);
  });

  it('has no frame limit', () => {
    const s = new GameStore();
    for (let t = 1; t <= 70_000; ++t) {
      s.apply(show(t));
    }
    expect(s.frameCount).toBe(70_000);
  });
});

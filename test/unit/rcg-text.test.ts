import { describe, expect, it } from 'vitest';
import { PlayMode, Side } from '../../src/core/constants';
import type { RcgRecord } from '../../src/core/records';
import type { ParseIssue } from '../../src/io/parse-types';
import { parseParamLine, parseTextRcg } from '../../src/io/rcg-text';

function parse(lines: string[], header = 'ULG5') {
  const records: RcgRecord[] = [];
  const warnings: ParseIssue[] = [];
  const stats = parseTextRcg([header, ...lines].join('\n') + '\n', {
    record: (r) => records.push(r),
    warning: (w) => warnings.push(w),
  });
  return { records, warnings, stats };
}

const shows = (records: RcgRecord[]) => records.flatMap((r) => (r.type === 'show' ? [r.show] : []));

// v5 player: capacity, 11 command counts.
const V5_L1 =
  '((l 1) 0 0x9 -36.2071 1.529 0 -0 124.51 -84 (v h 60) (s 8000 1 1 116613) (f l 5) ' +
  '(c 0 140 1183 0 1 1324 152 43 0 0 787))';
// v4 player: pointing, no capacity.
const V4_R2 =
  '((r 2) 3 0x1003 10.5 -3.25 0.1 0.2 -90 30 -20.5 12.25 (v l 120) (s 7000.5 0.9 0.95) ' +
  '(c 1 2 3 4 5 6 7 8 9 10 11))';
// v6 player: focus point, 12 command counts.
const V6_L7 =
  '((l 7) 2 0x41 1 2 3 4 5 6 (v h 90) (fp 3.5 -15) (s 6000 0.8 1 90000) (f r 3) ' +
  '(c 1 2 3 4 5 6 7 8 9 10 11 12))';

const show = (time: number, ...players: string[]) =>
  `(show ${time} ((b) -8.6946 29.6635 -0 0.5) ${players.join(' ')})`;

describe('parseTextRcg', () => {
  it('reads the players of v4, v5 and v6 logs', () => {
    const { records, warnings } = parse([show(1, V5_L1, V4_R2, V6_L7)]);
    expect(warnings).toEqual([]);
    const [s] = shows(records);
    expect(s?.ball).toEqual({ x: -8.6946, y: 29.6635, vx: -0, vy: 0.5 });
    expect(s?.players).toHaveLength(22);
    expect(s?.players[0]).toEqual({
      side: Side.Left,
      unum: 1,
      type: 0,
      state: 0x9,
      x: -36.2071,
      y: 1.529,
      vx: 0,
      vy: -0,
      body: 124.51,
      neck: -84,
      point: undefined,
      viewQuality: 'h',
      viewWidth: 60,
      focusPoint: undefined,
      stamina: 8000,
      effort: 1,
      recovery: 1,
      capacity: 116613,
      attention: { side: Side.Left, unum: 5 },
      counts: {
        kick: 0,
        dash: 140,
        turn: 1183,
        catch: 0,
        move: 1,
        turnNeck: 1324,
        changeView: 152,
        say: 43,
        tackle: 0,
        pointto: 0,
        attentionto: 787,
        changeFocus: undefined,
      },
    });
    expect(s?.players[12]).toMatchObject({
      side: Side.Right,
      unum: 2,
      type: 3,
      state: 0x1003,
      point: { x: -20.5, y: 12.25 },
      viewQuality: 'l',
      viewWidth: 120,
      stamina: 7000.5,
      capacity: undefined,
      attention: undefined,
    });
    expect(s?.players[6]).toMatchObject({
      focusPoint: { dist: 3.5, dir: -15 },
      capacity: 90000,
      attention: { side: Side.Right, unum: 3 },
      counts: { attentionto: 11, changeFocus: 12 },
    });
    expect(s?.players[1]).toMatchObject({ side: Side.Left, unum: 2, state: 0 });
  });

  it('estimates stime from repeated cycles', () => {
    const { records } = parse([
      show(10),
      '(playmode 11 offside_r)',
      show(11),
      show(11),
      '(msg 11 1 "(referee offside_r)")',
      show(11),
      show(12),
    ]);
    expect(shows(records).map((s) => [s.time, s.stime])).toEqual([
      [10, 0],
      [11, 0],
      [11, 1],
      [11, 2],
      [12, 0],
    ]);
    const pm = records.find((r) => r.type === 'playMode');
    expect(pm).toEqual({ type: 'playMode', time: 11, stime: 0, mode: PlayMode.OffSideRight });
    const msg = records.find((r) => r.type === 'msg');
    expect(msg).toMatchObject({ time: 11, stime: 2, board: 1, message: '(referee offside_r)' });
  });

  it('reads team lines with and without penalty counts', () => {
    const { records, warnings } = parse([
      '(team 1 null CYRUS 0 0)',
      '(team 6003 HELIOS2022 CYRUS 0 0 1 0 2 3)',
    ]);
    expect(warnings).toEqual([]);
    expect(records).toEqual([
      {
        type: 'team',
        time: 1,
        stime: 0,
        teams: [
          { name: '', score: 0, penScore: 0, penMiss: 0 },
          { name: 'CYRUS', score: 0, penScore: 0, penMiss: 0 },
        ],
      },
      {
        type: 'team',
        time: 6003,
        stime: 0,
        teams: [
          { name: 'HELIOS2022', score: 0, penScore: 1, penMiss: 0 },
          { name: 'CYRUS', score: 0, penScore: 2, penMiss: 3 },
        ],
      },
    ]);
  });

  it('reads team graphics without limiting the string length', () => {
    const { records, warnings } = parse([
      '(msg 0 1 "(team_graphic_r (2 7 "8 8 2 1" "  c None" ". c #0123456789AB" "........" "        " "        " "        " "        " "        " "        " "        "))")',
    ]);
    expect(warnings).toEqual([]);
    expect(records).toEqual([
      {
        type: 'teamGraphic',
        side: 'r',
        x: 2,
        y: 7,
        xpm: [
          '8 8 2 1',
          '  c None',
          '. c #0123456789AB',
          '........',
          ...Array<string>(7).fill('        '),
        ],
      },
    ]);
  });

  it('reads parameter lines', () => {
    const { records } = parse([
      '(server_param (goal_width 14.02)(coach 0)(landmark_file "~/.rcssserver-landmark.xml")(fixed_teamname_l ""))',
      '(player_type (id 3)(player_speed_max 1.05))',
    ]);
    expect(records).toEqual([
      {
        type: 'serverParam',
        params: {
          goal_width: 14.02,
          coach: 0,
          landmark_file: '~/.rcssserver-landmark.xml',
          fixed_teamname_l: '',
        },
      },
      { type: 'playerType', params: { id: 3, player_speed_max: 1.05 } },
    ]);
  });

  it('skips malformed lines with a warning and goes on', () => {
    const { records, warnings } = parse([
      show(1, V5_L1),
      '(show 2 ((b) 1 2 3))',
      show(3, V5_L1.replace('(s 8000', '(t 8000')),
      show(4, V5_L1.replace('((l 1)', '((l 12)')),
      '(playmode 5 no_such_mode)',
      '(bogus 1 2)',
      'garbage',
      show(6, V5_L1),
    ]);
    expect(shows(records).map((s) => s.time)).toEqual([1, 6]);
    expect(warnings).toEqual([
      { line: 3, message: 'illegal ball' },
      { line: 4, message: 'illegal player stamina' },
      { line: 5, message: 'illegal player l 12' },
      { line: 6, message: 'unknown play mode "no_such_mode"' },
      { line: 7, message: 'unknown record "bogus"' },
      { line: 8, message: 'illegal line' },
    ]);
  });

  it('rejects an unknown header', () => {
    const { records, warnings } = parse([show(1)], 'ULG3');
    expect(records).toEqual([]);
    expect(warnings).toEqual([{ line: 1, message: 'unknown header "ULG3"' }]);
  });

  it('accepts the live show extensions (pm) and (tm)', () => {
    const { records } = parse([
      '(show 5 (pm 3) (tm HELIOS null 1 0 0 0 0 0) ((b) 0 0 0 0) ' + V5_L1 + ')',
    ]);
    expect(records.map((r) => r.type)).toEqual(['playMode', 'team', 'show']);
    expect(records[0]).toMatchObject({ mode: PlayMode.PlayOn });
    expect(records[1]).toMatchObject({ teams: [{ name: 'HELIOS', score: 1 }, { name: '' }] });
  });
});

describe('parseParamLine', () => {
  it('handles escaped quotes and spaces in quoted values', () => {
    expect(parseParamLine('(server_param (a "x \\"y\\" z")(b -1.5e-3)(c on))')).toEqual({
      a: 'x "y" z',
      b: -0.0015,
      c: 'on',
    });
  });
});

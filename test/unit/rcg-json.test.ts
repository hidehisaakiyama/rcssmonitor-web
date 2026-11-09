import { describe, expect, it } from 'vitest';
import { PlayMode, Side } from '../../src/core/constants';
import type { RcgRecord } from '../../src/core/records';
import type { ParseIssue } from '../../src/io/parse-types';
import { jsonMessageToRecords, parseJsonRcg } from '../../src/io/rcg-json';

function parse(text: string) {
  const records: RcgRecord[] = [];
  const warnings: ParseIssue[] = [];
  const stats = parseJsonRcg(text, {
    record: (r) => records.push(r),
    warning: (w) => warnings.push(w),
  });
  return { records, warnings, stats };
}

const player = (side: string, unum: number, extra: object = {}) => ({
  side,
  unum,
  type: 0,
  state: 1,
  x: unum,
  y: side === 'l' ? 1 : -1,
  vx: 0,
  vy: 0,
  body: 0,
  neck: 0,
  vq: 'h',
  vw: 120,
  stamina: 8000,
  effort: 1,
  recovery: 1,
  capacity: 130600,
  ...extra,
});

const showLine = (time: number, players: object[], extra: object = {}) =>
  JSON.stringify({ show: { time, ...extra, ball: { x: 1, y: 2, vx: 3, vy: 4 }, players } });

const shows = (records: RcgRecord[]) => records.flatMap((r) => (r.type === 'show' ? [r.show] : []));

describe('parseJsonRcg', () => {
  it('reads a log line by line', () => {
    const text = [
      '[',
      '{"version":"19.0.0"},',
      '{"playmode":{"time":1,"mode":"kick_off_l"}},',
      showLine(1, [player('l', 1)]) + ',',
      showLine(2, [player('l', 1)], { stime: 3 }),
      ']',
      '',
    ].join('\n');
    const { records, warnings, stats } = parse(text);
    expect(warnings).toEqual([]);
    expect(records.map((r) => r.type)).toEqual(['version', 'playMode', 'show', 'show']);
    expect(stats.shows).toBe(2);
    expect(shows(records).map((s) => [s.time, s.stime])).toEqual([
      [1, 0],
      [2, 3],
    ]);
  });

  it('reads the ball height of the planned 2.5D simulator when it is there', () => {
    const flying = JSON.stringify({
      show: { time: 1, ball: { x: 1, y: 2, vx: 3, vy: 4, z: 1.5, vz: -0.2 }, players: [] },
    });
    const text = ['[', flying + ',', showLine(2, []), ']'].join('\n');
    const { records, warnings } = parse(text);
    expect(warnings).toEqual([]);
    expect(shows(records).map((s) => s.ball)).toEqual([
      { x: 1, y: 2, vx: 3, vy: 4, z: 1.5, vz: -0.2 },
      { x: 1, y: 2, vx: 3, vy: 4 }, // on the ground: no z
    ]);
  });

  it('accepts a log without the closing bracket', () => {
    const text = '[\n' + showLine(1, []) + ',\n' + showLine(2, []) + ',\n';
    const { records, warnings } = parse(text);
    expect(warnings).toEqual([]);
    expect(shows(records)).toHaveLength(2);
  });

  it('skips a truncated last line with a warning', () => {
    const text = '[\n' + showLine(1, []) + ',\n' + showLine(2, []).slice(0, 40);
    const { records, warnings } = parse(text);
    expect(shows(records)).toHaveLength(1);
    expect(warnings).toEqual([{ line: 3, message: 'not a JSON record' }]);
  });

  it('skips unknown keys and reports each once', () => {
    const text = ['[', '{"future":{"a":1}},', '{"future":{"a":2}},', showLine(1, []), ']'].join(
      '\n',
    );
    const { records, warnings } = parse(text);
    expect(shows(records)).toHaveLength(1);
    expect(warnings).toEqual([{ line: 2, message: 'unknown record "future" skipped' }]);
  });

  it('reads a log that is not one record per line', () => {
    const text = JSON.stringify([{ version: '19.0.0' }, JSON.parse(showLine(5, []))], null, 2);
    const { records, warnings } = parse(text);
    expect(warnings).toEqual([]);
    expect(records.map((r) => r.type)).toEqual(['version', 'show']);
  });

  it('places players by side and unum and fills the missing ones', () => {
    const { records } = parse(showLine(1, [player('r', 2), player('l', 11), player('l', 1)]));
    const [s] = shows(records);
    expect(s?.players).toHaveLength(22);
    expect(s?.players[0]).toMatchObject({ side: Side.Left, unum: 1, x: 1 });
    expect(s?.players[10]).toMatchObject({ side: Side.Left, unum: 11, x: 11 });
    expect(s?.players[12]).toMatchObject({ side: Side.Right, unum: 2, x: 2, y: -1 });
    expect(s?.players[11]).toMatchObject({ side: Side.Right, unum: 1, state: 0 });
  });

  it('reads the optional player fields', () => {
    const p = player('l', 3, {
      vq: 'l',
      px: -10,
      py: 5,
      fdist: 2.5,
      fdir: -30,
      fside: 'r',
      fnum: 9,
      kick: 1,
      dash: 2,
      turn: 3,
      catch: 4,
      move: 5,
      turn_neck: 6,
      change_view: 7,
      say: 8,
      tackle: 9,
      pointto: 10,
      attentionto: 11,
      change_focus: 12,
    });
    const s = shows(parse(showLine(1, [p, player('l', 4, { capacity: undefined })])).records)[0];
    expect(s?.players[2]).toMatchObject({
      viewQuality: 'l',
      viewWidth: 120,
      point: { x: -10, y: 5 },
      focusPoint: { dist: 2.5, dir: -30 },
      attention: { side: Side.Right, unum: 9 },
      capacity: 130600,
      counts: {
        kick: 1,
        dash: 2,
        turn: 3,
        catch: 4,
        move: 5,
        turnNeck: 6,
        changeView: 7,
        say: 8,
        tackle: 9,
        pointto: 10,
        attentionto: 11,
        changeFocus: 12,
      },
    });
    const q = s?.players[3];
    expect([q?.point, q?.focusPoint, q?.attention, q?.counts, q?.capacity]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('warns about illegal players', () => {
    const { records, warnings } = parse(showLine(1, [player('l', 12), player('x', 1)]));
    expect(shows(records)).toHaveLength(1);
    expect(warnings.map((w) => w.message)).toEqual([
      'show 1: illegal player l 12',
      'show 1: illegal player x 1',
    ]);
  });
});

describe('jsonMessageToRecords (live messages)', () => {
  it('splits a live show into play mode, team and show records', () => {
    const msg = JSON.parse(
      showLine(7, [], {
        stime: 2,
        mode: 'foul_push_r',
        team: {
          l: { name: 'A', score: 1 },
          r: { name: null, score: 0, pen_score: 2, pen_miss: 1 },
        },
      }),
    ) as unknown;
    const out: RcgRecord[] = [];
    jsonMessageToRecords(
      msg,
      (r) => out.push(r),
      () => undefined,
    );
    expect(out.map((r) => r.type)).toEqual(['playMode', 'team', 'show']);
    expect(out[0]).toEqual({ type: 'playMode', time: 7, stime: 2, mode: PlayMode.FoulPushRight });
    expect(out[1]).toEqual({
      type: 'team',
      time: 7,
      stime: 2,
      teams: [
        { name: 'A', score: 1, penScore: 0, penMiss: 0 },
        { name: '', score: 0, penScore: 2, penMiss: 1 },
      ],
    });
  });

  it('reports a message that is not an object', () => {
    const warnings: string[] = [];
    jsonMessageToRecords(
      [1, 2],
      () => undefined,
      (m) => warnings.push(m),
    );
    expect(warnings).toEqual(['record is not an object']);
  });
});

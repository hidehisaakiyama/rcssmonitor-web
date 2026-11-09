// Loads the fixtures end to end: gzip, format detection, parsing and the
// GameStore. The expected values were computed from the fixtures with an
// independent script, not with this code.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAYMODE_STRINGS, Side } from '../../src/core/constants';
import { GameStore } from '../../src/core/game-store';
import { isGoalie } from '../../src/core/frame';
import { LogFormatError } from '../../src/io/load';
import { jsonMessageToRecords } from '../../src/io/rcg-json';
import { fixturePath, loadBytes, loadFixture, modeRuns } from './helpers';

const ascii = (s: string) => new TextEncoder().encode(s);
const times = (store: GameStore, time: number) =>
  store.frames.flatMap((f, i) => (f.time === time ? [[i, f.stime]] : []));

describe('json-sample.rcg.gz', async () => {
  const { store, result, warnings } = await loadFixture('json-sample.rcg.gz');

  it('is read without warnings', () => {
    expect(warnings).toEqual([]);
    expect(result.info).toEqual({ format: { kind: 'json' }, gzip: true, size: 2_335_974 });
    expect(result.records).toBe(557);
    expect(result.shows).toBe(267);
  });

  it('has the header records', () => {
    expect(store.serverVersion).toBe('18.1.3');
    expect(store.timestamp).toBe('2024-03-19T18:13:33+0900');
    expect(store.serverParam.coach_w_referee).toBe(true);
    expect(store.serverParam.game_log_version).toBe(-1);
    expect(store.serverParam.nr_extra_halfs).toBe(0);
    expect(store.playerParam.catchable_area_l_stretch_max).toBe(1.3);
    expect(store.playerTypes).toHaveLength(18);
    expect(store.playerType(1).id).toBe(1);
  });

  it('has the frames and play modes of the original log', () => {
    expect(store.frameCount).toBe(267);
    expect(modeRuns(store, PLAYMODE_STRINGS)).toEqual([
      [0, 'kick_off_l'],
      [4, 'play_on'],
      [207, 'foul_charge_l'],
      [237, 'free_kick_r'],
      [251, 'play_on'],
      [256, 'kick_off_r'],
      [261, 'play_on'],
      [266, 'time_over'],
    ]);
    expect(store.frame(0)?.time).toBe(1);
    expect(store.lastFrame?.time).toBe(6000);
    expect(store.indexOfTime(3001)).toBe(256);
  });

  it('keeps the stime of the stopped cycles', () => {
    const at1746 = times(store, 1746);
    expect(at1746).toHaveLength(31);
    expect(at1746[0]).toEqual([206, 0]);
    expect(at1746[30]).toEqual([236, 30]);
    expect(store.indexOfTime(1746)).toBe(206);
  });

  it('has the values of a player', () => {
    const f = store.frame(0);
    expect(f?.teams.map((t) => [t.name, t.score])).toEqual([
      ['HELIOS2023', 0],
      ['CYRUS', 0],
    ]);
    expect(f?.ball).toEqual({ x: 0, y: 0, vx: 0, vy: 0 });
    const goalie = f?.players[0];
    expect(goalie).toMatchObject({ side: Side.Left, unum: 1, x: -49, y: 0, body: -124.215 });
    expect(goalie && isGoalie(goalie)).toBe(true);
    expect(f?.players[15]).toMatchObject({
      side: Side.Right,
      unum: 5,
      type: 1,
      state: 1,
      x: 15,
      y: 7,
      body: 38.836,
      viewWidth: 180,
      effort: 0.977079,
      capacity: 130600,
      focusPoint: undefined,
      counts: { turn: 42, turnNeck: 43, changeFocus: 0 },
    });
  });

  it('has no score change and one result message', () => {
    expect(store.scoreChanges).toEqual([]);
    expect(store.messages).toEqual([
      {
        time: 6000,
        stime: 5449,
        board: 1,
        message: '(result 202403191813 HELIOS2023_0-vs-CYRUS_0)',
        frameIndex: 267,
      },
    ]);
  });

  it('has the left team logo only', () => {
    const [l, r] = store.teamGraphics;
    expect([l.width, l.height, l.tileCount, l.isComplete()]).toEqual([256, 64, 256, true]);
    expect(l.unknownColors.size).toBe(0);
    expect(r.isEmpty()).toBe(true);
    expect(store.rejectedTiles).toBe(0);
  });
});

describe('text-v5-sample.rcg.gz', async () => {
  const { store, result, warnings } = await loadFixture('text-v5-sample.rcg.gz');

  it('is read without warnings', () => {
    expect(warnings).toEqual([]);
    expect(result.info).toEqual({
      format: { kind: 'text', version: 5 },
      gzip: true,
      size: 1_117_172,
    });
    expect(result.shows).toBe(312);
  });

  it('has the header records', () => {
    expect(store.serverParam.game_log_version).toBe(5);
    expect(store.serverParam.coach_w_referee).toBe(false);
    expect(store.serverParam.penalty_shoot_outs).toBe(true);
    expect(store.serverParam.landmark_file).toBe('~/.rcssserver-landmark.xml');
    expect(store.playerTypes).toHaveLength(18);
    expect(store.playerType(1).player_decay).toBe(0.308067);
  });

  it('has the frames and play modes of the original log', () => {
    expect(store.frameCount).toBe(312);
    expect(modeRuns(store, PLAYMODE_STRINGS)).toEqual([
      [0, 'kick_off_l'],
      [3, 'play_on'],
      [204, 'offside_r'],
      [234, 'free_kick_l'],
      [240, 'play_on'],
      [248, 'goal_l'],
      [299, 'kick_off_r'],
      [306, 'play_on'],
      [311, 'time_over'],
    ]);
    expect(store.lastFrame?.time).toBe(8000);
  });

  it('estimates stime from the repeated show lines', () => {
    const at789 = times(store, 789);
    expect(at789).toHaveLength(30);
    expect(at789[0]).toEqual([204, 0]);
    expect(at789[29]).toEqual([233, 29]);
    const at6713 = times(store, 6713);
    expect(at6713).toHaveLength(51);
    expect(at6713[50]).toEqual([298, 50]);
  });

  it('records the goal', () => {
    expect(store.scoreChanges).toEqual([248]);
    expect(store.frame(248)?.teams.map((t) => [t.name, t.score])).toEqual([
      ['HELIOS2022', 1],
      ['CYRUS', 0],
    ]);
    expect(store.frame(247)?.teams[0].score).toBe(0);
  });

  it('has the values of a player', () => {
    expect(store.frame(204)?.players[0]).toMatchObject({
      side: Side.Left,
      unum: 1,
      state: 0x9,
      x: -36.2071,
      y: 1.529,
      body: 124.51,
      neck: -84,
      viewWidth: 60,
      capacity: 116613,
      attention: { side: Side.Left, unum: 5 },
      counts: { dash: 140, attentionto: 787, changeFocus: undefined },
    });
  });

  it('has both team logos', () => {
    for (const g of store.teamGraphics) {
      expect([g.width, g.height, g.tileCount, g.isComplete()]).toEqual([256, 64, 256, true]);
      expect(g.unknownColors.size).toBe(0);
    }
    expect(store.messages.map((m) => m.message)).toEqual([
      '(result 202207160432 HELIOS2022_1-vs-CYRUS_0)',
    ]);
  });
});

describe.each(['json-pk.rcg.gz', 'text-v5-pk.rcg.gz'])('%s (synthetic shoot-out)', async (name) => {
  const { store, warnings } = await loadFixture(name);

  it('records every kick in order', () => {
    expect(warnings).toEqual([]);
    expect(store.frameCount).toBe(43);
    const kicks = (side: Side) =>
      store.penaltyKicks(side).map((k) => [k.time, k.frameIndex, k.scored ? 'o' : 'x']);
    expect(kicks(Side.Left)).toEqual([
      [6003, 5, 'o'],
      [6011, 13, 'x'],
      [6019, 21, 'o'],
      [6027, 29, 'o'],
      [6035, 37, 'o'],
    ]);
    expect(kicks(Side.Right)).toEqual([
      [6007, 9, 'o'],
      [6015, 17, 'o'],
      [6023, 25, 'x'],
      [6031, 33, 'o'],
      [6039, 41, 'x'],
    ]);
  });

  it('has the penalty counts in the teams', () => {
    const [l, r] = store.lastFrame?.teams ?? [];
    expect([l?.penScore, l?.penMiss, r?.penScore, r?.penMiss]).toEqual([4, 1, 3, 2]);
    expect(store.frame(5)?.teams[0].penScore).toBe(1);
    expect(store.frame(4)?.teams[0].penScore).toBe(0);
    expect(store.scoreChanges).toEqual([]);
  });
});

describe('live-before-kickoff.jsonl (captured from rcssserver 19.0.0)', () => {
  const store = new GameStore();
  const warnings: string[] = [];
  for (const line of readFileSync(fixturePath('live-before-kickoff.jsonl'), 'utf8').split('\n')) {
    if (line !== '') {
      jsonMessageToRecords(
        JSON.parse(line),
        (r) => store.apply(r),
        (m) => warnings.push(m),
      );
    }
  }

  it('builds frames from live messages', () => {
    expect(warnings).toEqual([]);
    expect(store.playerTypes).toHaveLength(18);
    expect(store.serverParam.effort_inc).toBe(0.01);
    expect(store.frames.map((f) => [f.time, f.stime, PLAYMODE_STRINGS[f.mode]])).toEqual([
      [0, 101, 'before_kick_off'],
      [0, 102, 'before_kick_off'],
    ]);
  });

  it('reads unnamed teams, disconnected players and the focus point', () => {
    const f = store.frame(0);
    expect(f?.teams.map((t) => t.name)).toEqual(['', '']);
    expect(f?.players[1]).toMatchObject({
      side: Side.Left,
      unum: 2,
      state: 0,
      x: -6,
      y: -37,
      focusPoint: { dist: 0, dir: 0 },
      counts: undefined,
    });
    expect(f?.players[21]).toMatchObject({ side: Side.Right, unum: 11, x: 33, y: -37 });
  });
});

describe('loadRcgBytes errors', () => {
  it.each([
    ['an empty file', new Uint8Array(), 'the file is empty'],
    ['a binary log', new Uint8Array([0x55, 0x4c, 0x47, 3, 0]), 'unsupported log format: binary v3'],
    ['a headerless file', ascii('hello'), 'unsupported log format: binary v1'],
    ['a log without shows', ascii('ULG5\n(playmode 1 play_on)\n'), 'no show record found'],
    ['broken gzip', new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3]), 'cannot decompress'],
  ])('rejects %s', async (_, bytes, message) => {
    const promise = loadBytes(bytes);
    await expect(promise).rejects.toThrow(LogFormatError);
    await expect(promise).rejects.toThrow(message);
  });

  it('reads an uncompressed JSON log with a BOM', async () => {
    const show = JSON.stringify({
      show: { time: 3, ball: { x: 0, y: 0, vx: 0, vy: 0 }, players: [] },
    });
    const { store, result } = await loadBytes(ascii(`\uFEFF[\n${show}\n]\n`));
    expect(result.info.gzip).toBe(false);
    expect(store.frame(0)?.time).toBe(3);
  });
});

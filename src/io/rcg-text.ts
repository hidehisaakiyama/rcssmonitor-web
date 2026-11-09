// Text game logs, versions 4 to 6 ("ULG4" - "ULG6").
// Port of rcssmonitor's rcss/rcg/parser_v4.cpp, with these differences:
//
// - A malformed line is skipped with a warning instead of stopping the parse.
// - Text logs have no stime. While the game is stopped, the server writes
//   the same cycle again for every stopped step, so the n-th repeated show of
//   a cycle gets stime n (0 for the first).
// - Team graphic strings are not limited to 15 characters.
// - A team name "null" is read as an empty name in team lines too.
import {
  MAX_PLAYER,
  playModeFromNumber,
  playModeFromString,
  PlayMode,
  sideFromChar,
  sideToChar,
} from '../core/constants';
import {
  disabledPlayer,
  playerIndex,
  type CommandCounts,
  type PlayerState,
  type ShowData,
  type TeamInfo,
} from '../core/frame';
import type { ParamValue } from '../core/params';
import type { RecordSink } from '../core/records';
import {
  ParseCounter,
  progressReporter,
  type ParseCallbacks,
  type ParseStats,
} from './parse-types';

/** Parses a whole text log, header line included. */
export function parseTextRcg(text: string, cb: ParseCallbacks): ParseStats {
  const counter = new ParseCounter(cb);
  const report = progressReporter(cb, text.length);
  const parser = new TextLineParser(counter.sink, (line, message) => counter.warn(line, message));

  let pos = 0;
  let lineNo = 0;
  while (pos < text.length) {
    let end = text.indexOf('\n', pos);
    if (end < 0) {
      end = text.length;
    }
    ++lineNo;
    const line = text.slice(pos, end);
    pos = end + 1;
    report(pos);

    if (lineNo === 1) {
      const header = line.replace(/^\uFEFF/, '').trim();
      if (!/^ULG[456]$/.test(header)) {
        counter.warn(1, `unknown header "${header.slice(0, 16)}"`);
        return counter.stats(lineNo);
      }
      continue;
    }
    parser.parseLine(line, lineNo);
  }
  cb.progress?.(1);
  return counter.stats(lineNo);
}

/**
 * Parses the lines of a text log after the header. It keeps the state needed
 * to estimate stime, so one instance must see the lines in order.
 */
export class TextLineParser {
  private lastShowTime = -1;
  private repeat = 0;

  constructor(
    private readonly sink: RecordSink,
    private readonly warn: (line: number, message: string) => void,
  ) {}

  parseLine(raw: string, lineNo = 0): void {
    const line = raw.trim();
    if (line === '') {
      return;
    }
    const m = /^\(\s*([a-z_]+)/.exec(line);
    if (!m) {
      this.warn(lineNo, 'illegal line');
      return;
    }
    let error: string | null;
    switch (m[1]) {
      case 'show':
        error = this.parseShow(line);
        break;
      case 'playmode':
        error = this.parsePlayMode(line);
        break;
      case 'team':
        error = this.parseTeam(line);
        break;
      case 'msg':
        error = this.parseMsg(line);
        break;
      case 'server_param':
        this.sink({ type: 'serverParam', params: parseParamLine(line) });
        error = null;
        break;
      case 'player_param':
        this.sink({ type: 'playerParam', params: parseParamLine(line) });
        error = null;
        break;
      case 'player_type':
        this.sink({ type: 'playerType', params: parseParamLine(line) });
        error = null;
        break;
      default:
        error = `unknown record "${m[1] ?? ''}"`;
    }
    if (error !== null) {
      this.warn(lineNo, error);
    }
  }

  /** stime for a non-show record of `time`: that of the next show of the same cycle. */
  private stimeFor(time: number): number {
    return time === this.lastShowTime ? this.repeat + 1 : 0;
  }

  // (show T [(pm N)] [(tm L R SL SR [PSL PML PSR PMR])] ((b) x y vx vy) PLAYER...)
  private parseShow(line: string): string | null {
    const c = new Cursor(line);
    c.expect('(');
    c.expect('show');
    const time = c.number();
    if (!Number.isInteger(time)) {
      return 'illegal show time';
    }
    const stime = this.stimeFor(time);

    // Only the live text protocol has these, but rcssmonitor accepts them in logs.
    c.skipSpaces();
    if (c.startsWith('(pm')) {
      c.skip(3);
      const pm = c.number();
      c.expect(')');
      this.sink({ type: 'playMode', time, stime, mode: playModeFromNumber(pm) });
    }
    c.skipSpaces();
    if (c.startsWith('(tm')) {
      c.skip(3);
      const nameL = c.token();
      const nameR = c.token();
      const nums: number[] = [];
      while (c.beforeClose()) {
        nums.push(c.number());
      }
      c.expect(')');
      if (nums.length !== 2 && nums.length !== 6) {
        return 'illegal team info in show';
      }
      this.sink({ type: 'team', time, stime, teams: teamsFrom(nameL, nameR, nums) });
    }

    if (!c.expect('((b)')) {
      return 'illegal ball';
    }
    const ball = { x: c.number(), y: c.number(), vx: c.number(), vy: c.number() };
    if (!c.expect(')') || c.bad) {
      return 'illegal ball';
    }

    const players: (PlayerState | undefined)[] = new Array<PlayerState | undefined>(2 * MAX_PLAYER);
    for (;;) {
      c.skipSpaces();
      if (c.done || c.peek() === ')') {
        break;
      }
      const p = parsePlayer(c);
      if (typeof p === 'string') {
        return p;
      }
      const idx = playerIndex(p.side, p.unum);
      if (idx < 0) {
        return `illegal player ${sideToChar(p.side)} ${p.unum}`;
      }
      players[idx] = p;
    }

    if (time === this.lastShowTime) {
      ++this.repeat;
    } else {
      this.lastShowTime = time;
      this.repeat = 0;
    }
    const show: ShowData = {
      time,
      stime: this.repeat,
      ball,
      players: Array.from(players, (p, i) => p ?? disabledPlayer(i)),
    };
    this.sink({ type: 'show', show });
    return null;
  }

  // (playmode T MODE)
  private parsePlayMode(line: string): string | null {
    const t = tokens(line);
    const time = Number(t[1]);
    const name = t[2];
    if (t.length !== 3 || !Number.isInteger(time) || name === undefined) {
      return 'illegal playmode line';
    }
    const mode = playModeFromString(name);
    if (mode === PlayMode.Null) {
      return `unknown play mode "${name}"`;
    }
    this.sink({ type: 'playMode', time, stime: this.stimeFor(time), mode });
    return null;
  }

  // (team T NAME_L NAME_R SCORE_L SCORE_R [PEN_SCORE_L PEN_MISS_L PEN_SCORE_R PEN_MISS_R])
  private parseTeam(line: string): string | null {
    const t = tokens(line);
    const time = Number(t[1]);
    const nums = t.slice(4).map(Number);
    if (
      !Number.isInteger(time) ||
      (nums.length !== 2 && nums.length !== 6) ||
      nums.some((n) => !Number.isFinite(n))
    ) {
      return 'illegal team line';
    }
    this.sink({
      type: 'team',
      time,
      stime: this.stimeFor(time),
      teams: teamsFrom(t[2] ?? '', t[3] ?? '', nums),
    });
    return null;
  }

  // (msg T BOARD "MESSAGE")
  private parseMsg(line: string): string | null {
    const c = new Cursor(line);
    c.expect('(');
    c.expect('msg');
    const time = c.number();
    const board = c.number();
    c.skipSpaces();
    const start = c.pos + 1;
    const end = line.lastIndexOf('")');
    if (c.bad || c.peek() !== '"' || end < start) {
      return 'illegal msg line';
    }
    const message = line.slice(start, end);
    if (message.startsWith('(team_graphic_')) {
      return this.parseTeamGraphic(message);
    }
    this.sink({ type: 'msg', time, stime: this.stimeFor(time), board, message });
    return null;
  }

  // (team_graphic_l (X Y "XPM" "XPM" ...))
  // The XPM strings are quoted inside the quoted message, so the quotes nest.
  private parseTeamGraphic(message: string): string | null {
    const side = message.charAt('(team_graphic_'.length);
    const c = new Cursor(message);
    c.skip('(team_graphic_'.length + 1);
    c.expect('(');
    const x = c.number();
    const y = c.number();
    if ((side !== 'l' && side !== 'r') || !Number.isInteger(x) || !Number.isInteger(y)) {
      return 'illegal team_graphic';
    }
    const xpm: string[] = [];
    const re = /"([^"]*)"/g;
    re.lastIndex = c.pos;
    for (let m = re.exec(message); m; m = re.exec(message)) {
      xpm.push(m[1] ?? '');
    }
    if (xpm.length === 0) {
      return 'team_graphic without XPM data';
    }
    this.sink({ type: 'teamGraphic', side, x, y, xpm });
    return null;
  }
}

// ((SIDE UNUM) TYPE STATE x y vx vy body neck [px py] (v Q W) [(fp DIST DIR)]
//  (s STAMINA EFFORT RECOVERY [CAPACITY]) [(f SIDE UNUM)] (c COUNT...))
function parsePlayer(c: Cursor): PlayerState | string {
  if (!c.expect('((')) {
    return 'illegal player';
  }
  const sideChar = c.peek();
  if (sideChar !== 'l' && sideChar !== 'r') {
    return `illegal player side "${sideChar}"`;
  }
  c.skip(1);
  const unum = c.number();
  c.expect(')');
  const type = c.number();
  const state = c.hex();
  const x = c.number();
  const y = c.number();
  const vx = c.number();
  const vy = c.number();
  const body = c.number();
  const neck = c.number();

  let point: PlayerState['point'];
  c.skipSpaces();
  if (c.peek() !== '(') {
    point = { x: c.number(), y: c.number() };
  }

  if (!c.expect('(v')) {
    return 'illegal player view';
  }
  const q = c.token();
  const viewWidth = c.number();
  c.expect(')');

  let focusPoint: PlayerState['focusPoint'];
  c.skipSpaces();
  if (c.startsWith('(fp')) {
    c.skip(3);
    focusPoint = { dist: c.number(), dir: c.number() };
    c.expect(')');
  }

  if (!c.expect('(s')) {
    return 'illegal player stamina';
  }
  const stamina = c.number();
  const effort = c.number();
  const recovery = c.number();
  c.skipSpaces();
  const capacity = c.peek() !== ')' ? c.number() : undefined;
  c.expect(')');

  let attention: PlayerState['attention'];
  c.skipSpaces();
  if (c.startsWith('(f ')) {
    c.skip(2);
    const fside = c.token();
    const fnum = c.number();
    c.expect(')');
    attention = { side: sideFromChar(fside), unum: fnum };
  }

  if (!c.expect('(c')) {
    return 'illegal player command counts';
  }
  const n: number[] = [];
  while (c.beforeClose()) {
    n.push(c.number());
  }
  if (!c.expect(')') || !c.expect(')')) {
    return 'illegal player end';
  }
  if (c.bad || n.length < 11) {
    return `illegal player values (${sideChar} ${unum})`;
  }
  const counts: CommandCounts = {
    kick: n[0] ?? 0,
    dash: n[1] ?? 0,
    turn: n[2] ?? 0,
    catch: n[3] ?? 0,
    move: n[4] ?? 0,
    turnNeck: n[5] ?? 0,
    changeView: n[6] ?? 0,
    say: n[7] ?? 0,
    tackle: n[8] ?? 0,
    pointto: n[9] ?? 0,
    attentionto: n[10] ?? 0,
    changeFocus: n[11],
  };

  return {
    side: sideFromChar(sideChar),
    unum,
    type,
    state,
    x,
    y,
    vx,
    vy,
    body,
    neck,
    point,
    viewQuality: q === 'l' ? 'l' : 'h',
    viewWidth,
    focusPoint,
    stamina,
    effort,
    recovery,
    capacity,
    attention,
    counts,
  };
}

function teamsFrom(nameL: string, nameR: string, nums: readonly number[]): [TeamInfo, TeamInfo] {
  // Scores come first, then the penalty counts of each side if present.
  const [scoreL = 0, scoreR = 0, penScoreL = 0, penMissL = 0, penScoreR = 0, penMissR = 0] = nums;
  return [
    { name: teamName(nameL), score: scoreL, penScore: penScoreL, penMiss: penMissL },
    { name: teamName(nameR), score: scoreR, penScore: penScoreR, penMiss: penMissR },
  ];
}

function teamName(name: string): string {
  return name === 'null' ? '' : name;
}

/** Splits "(a b c)" into ["a", "b", "c"]. */
function tokens(line: string): string[] {
  return line
    .replace(/^\(\s*/, '')
    .replace(/\s*\)\s*$/, '')
    .split(/\s+/);
}

/**
 * Parses "(name (key value)(key value)...)" (rcssmonitor's
 * parse_server_message). A double-quoted value becomes a string without the
 * quotes; other values become numbers when they look like numbers.
 */
export function parseParamLine(line: string): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  const head = /^\(\s*[a-z_]+\s*/.exec(line);
  let pos = head ? head[0].length : 0;
  for (;;) {
    const open = line.indexOf('(', pos);
    if (open < 0) {
      break;
    }
    const space = line.indexOf(' ', open);
    if (space < 0) {
      break;
    }
    const name = line.slice(open + 1, space);
    let value: ParamValue;
    let i = space + 1;
    while (line.charAt(i) === ' ') {
      ++i;
    }
    if (line.charAt(i) === '"') {
      let end = i + 1;
      while (end < line.length && !(line.charAt(end) === '"' && line.charAt(end - 1) !== '\\')) {
        ++end;
      }
      value = line.slice(i + 1, end).replace(/\\"/g, '"');
      const close = line.indexOf(')', end);
      pos = close < 0 ? line.length : close + 1;
    } else {
      const close = line.indexOf(')', i);
      const raw = line.slice(i, close < 0 ? line.length : close).trim();
      const n = Number(raw);
      value = raw !== '' && Number.isFinite(n) ? n : raw;
      pos = close < 0 ? line.length : close + 1;
    }
    if (name !== '') {
      out[name] = value;
    }
  }
  return out;
}

/** A position in a line, with strtol / strtof-like readers. */
class Cursor {
  pos = 0;
  /** Set when a number could not be read. */
  bad = false;

  constructor(private readonly s: string) {}

  get done(): boolean {
    return this.pos >= this.s.length;
  }

  peek(): string {
    return this.s.charAt(this.pos);
  }

  skip(n: number): void {
    this.pos += n;
  }

  skipSpaces(): void {
    for (;;) {
      const ch = this.s.charCodeAt(this.pos);
      if (ch !== 0x20 && ch !== 0x09) {
        return;
      }
      ++this.pos;
    }
  }

  /** Skips spaces and tells whether a value follows before ")" or the end. */
  beforeClose(): boolean {
    this.skipSpaces();
    return !this.done && this.peek() !== ')';
  }

  startsWith(text: string): boolean {
    return this.s.startsWith(text, this.pos);
  }

  /** Skips spaces and then `text` if it is there. */
  expect(text: string): boolean {
    this.skipSpaces();
    if (this.s.startsWith(text, this.pos)) {
      this.pos += text.length;
      return true;
    }
    return false;
  }

  /** Reads characters up to a space or a parenthesis. */
  token(): string {
    this.skipSpaces();
    const start = this.pos;
    for (;;) {
      const ch = this.s.charCodeAt(this.pos);
      if (Number.isNaN(ch) || ch === 0x20 || ch === 0x09 || ch === 0x28 || ch === 0x29) {
        break;
      }
      ++this.pos;
    }
    return this.s.slice(start, this.pos);
  }

  number(): number {
    const t = this.token();
    const n = t === '' ? NaN : Number(t);
    if (Number.isNaN(n)) {
      this.bad = true;
    }
    return n;
  }

  /** Reads a hexadecimal number with or without "0x". */
  hex(): number {
    const n = parseInt(this.token(), 16);
    if (Number.isNaN(n)) {
      this.bad = true;
    }
    return n;
  }
}

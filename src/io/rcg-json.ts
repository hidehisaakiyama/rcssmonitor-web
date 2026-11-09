// JSON game logs (game_log_version = -1) and JSON monitor messages.
//
// A JSON log is an array with one record per line: "[", then records
// separated by ",\n", then "]". The closing "]" is missing when the server
// stopped abnormally, so the log is read line by line.
//
// Fixes over rcssmonitor's rcss/rcg/parser_simdjson.cpp: unknown keys are
// skipped instead of stopping the parse, "vq" is a character, players are
// placed by side and unum instead of array order, and a broken line is
// skipped instead of aborting.
import {
  MAX_PLAYER,
  PlayMode,
  playModeFromString,
  sideFromChar,
  type Side,
  type SideChar,
} from '../core/constants';
import {
  disabledPlayer,
  playerIndex,
  type BallState,
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

type Json = Record<string, unknown>;
type Warn = (message: string) => void;

/** Parses a whole JSON log. */
export function parseJsonRcg(text: string, cb: ParseCallbacks): ParseStats {
  if (!isOneRecordPerLine(text)) {
    // E.g. a log reformatted by a JSON tool.
    return parseWholeDocument(text, cb);
  }
  const counter = new ParseCounter(cb);
  const report = progressReporter(cb, text.length);
  const unknownKeys = new Set<string>();
  let lineNo = 0;
  let pos = 0;

  while (pos < text.length) {
    let end = text.indexOf('\n', pos);
    if (end < 0) {
      end = text.length;
    }
    ++lineNo;
    let line = text.slice(pos, end).trim();
    pos = end + 1;
    report(pos);

    if (lineNo === 1 && line.charCodeAt(0) === 0xfeff) {
      line = line.slice(1).trim();
    }
    if (line.startsWith('[')) {
      line = line.slice(1).trim();
    }
    if (line.endsWith(']')) {
      // "]" closing the log, possibly after the last record on the same line.
      const rest = line.slice(0, -1).trimEnd();
      if (rest === '' || rest.endsWith('}')) {
        line = rest;
      }
    }
    if (line.endsWith(',')) {
      line = line.slice(0, -1).trim();
    }
    if (line === '') {
      continue;
    }

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      counter.warn(lineNo, 'not a JSON record');
      continue;
    }
    const n = lineNo;
    jsonMessageToRecords(value, counter.sink, (message) => counter.warn(n, message), unknownKeys);
  }

  cb.progress?.(1);
  return counter.stats(lineNo);
}

/** True if the first record sits on a line of its own, as the server writes it. */
function isOneRecordPerLine(text: string): boolean {
  let pos = 0;
  while (pos < text.length) {
    let end = text.indexOf('\n', pos);
    if (end < 0) {
      end = text.length;
    }
    let line = text
      .slice(pos, end)
      .replace(/^\uFEFF/, '')
      .trim();
    pos = end + 1;
    if (line.startsWith('[')) {
      line = line.slice(1).trim();
    }
    if (line !== '') {
      return line.startsWith('{') && /\}\s*[,\]]?$/.test(line);
    }
  }
  return true;
}

function parseWholeDocument(text: string, cb: ParseCallbacks): ParseStats {
  const counter = new ParseCounter(cb);
  let doc: unknown;
  try {
    doc = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    counter.warn(0, `not a JSON log: ${String(e)}`);
    return counter.stats(0);
  }
  if (!Array.isArray(doc)) {
    counter.warn(0, 'not a JSON log: the top level is not an array');
    return counter.stats(0);
  }
  const unknownKeys = new Set<string>();
  doc.forEach((value, i) => {
    jsonMessageToRecords(value, counter.sink, (m) => counter.warn(i + 1, m), unknownKeys);
  });
  cb.progress?.(1);
  return counter.stats(doc.length);
}

/**
 * Converts one JSON log record or one live monitor message to records.
 * A live show carries the play mode and the teams; they are emitted as
 * playMode and team records before the show, as rcssmonitor does.
 *
 * @param unknownKeys keys already reported, so that each is reported once
 */
export function jsonMessageToRecords(
  value: unknown,
  sink: RecordSink,
  warn: Warn,
  unknownKeys: Set<string> = new Set(),
): void {
  if (!isObject(value)) {
    warn('record is not an object');
    return;
  }
  for (const [key, body] of Object.entries(value)) {
    switch (key) {
      case 'show':
        convertShow(body, sink, warn);
        break;
      case 'playmode':
        convertPlayMode(body, sink, warn);
        break;
      case 'team':
        convertTeam(body, sink, warn);
        break;
      case 'msg':
        convertMsg(body, sink, warn);
        break;
      case 'team_graphic':
        convertTeamGraphic(body, sink, warn);
        break;
      case 'server_param':
      case 'player_param':
      case 'player_type': {
        const params = toParams(body);
        if (!params) {
          warn(`${key} is not an object`);
          break;
        }
        sink({
          type:
            key === 'server_param'
              ? 'serverParam'
              : key === 'player_param'
                ? 'playerParam'
                : 'playerType',
          params,
        });
        break;
      }
      case 'version':
        sink({ type: 'version', version: String(body) });
        break;
      case 'timestamp':
        sink({ type: 'timestamp', timestamp: String(body) });
        break;
      default:
        if (!unknownKeys.has(key)) {
          unknownKeys.add(key);
          warn(`unknown record "${key}" skipped`);
        }
    }
  }
}

function convertShow(body: unknown, sink: RecordSink, warn: Warn): void {
  if (!isObject(body) || typeof body['time'] !== 'number') {
    warn('show without time');
    return;
  }
  const time = body['time'];
  const stime = num(body['stime']);

  if (typeof body['mode'] === 'string') {
    convertPlayMode({ time, stime, mode: body['mode'] }, sink, warn);
  }
  if (isObject(body['team'])) {
    convertTeam({ ...body['team'], time, stime }, sink, warn);
  }

  const b = body['ball'];
  if (!isObject(b)) {
    warn(`show ${time}: no ball`);
    return;
  }
  const ball: BallState = {
    x: num(b['x']),
    y: num(b['y']),
    vx: num(b['vx']),
    vy: num(b['vy']),
    // The height, for the planned 2.5D simulator (keys provisional).
    ...(typeof b['z'] === 'number' ? { z: b['z'] } : {}),
    ...(typeof b['vz'] === 'number' ? { vz: b['vz'] } : {}),
  };

  const players: (PlayerState | undefined)[] = new Array<PlayerState | undefined>(2 * MAX_PLAYER);
  const list = body['players'];
  if (Array.isArray(list)) {
    for (const p of list) {
      if (!isObject(p)) {
        continue;
      }
      const side = sideFromChar(str(p['side']));
      const unum = num(p['unum']);
      const idx = playerIndex(side, unum);
      if (idx < 0) {
        warn(`show ${time}: illegal player ${str(p['side'])} ${unum}`);
        continue;
      }
      if (players[idx]) {
        warn(`show ${time}: duplicate player ${str(p['side'])} ${unum}`);
      }
      players[idx] = convertPlayer(p, side, unum);
    }
  }
  const show: ShowData = {
    time,
    stime,
    ball,
    players: Array.from(players, (p, i) => p ?? disabledPlayer(i)),
  };
  sink({ type: 'show', show });
}

function convertPlayer(p: Json, side: Side, unum: number): PlayerState {
  const px = p['px'];
  const py = p['py'];
  const fdist = p['fdist'];
  const fdir = p['fdir'];
  const capacity = p['capacity'];
  const fside = p['fside'];
  const fnum = p['fnum'];
  return {
    side,
    unum,
    type: num(p['type']),
    state: num(p['state']),
    x: num(p['x']),
    y: num(p['y']),
    vx: num(p['vx']),
    vy: num(p['vy']),
    body: num(p['body']),
    neck: num(p['neck']),
    point: typeof px === 'number' && typeof py === 'number' ? { x: px, y: py } : undefined,
    viewQuality: p['vq'] === 'l' ? 'l' : 'h',
    viewWidth: num(p['vw']),
    focusPoint:
      typeof fdist === 'number' && typeof fdir === 'number'
        ? { dist: fdist, dir: fdir }
        : undefined,
    stamina: num(p['stamina']),
    effort: num(p['effort']),
    recovery: num(p['recovery']),
    capacity: typeof capacity === 'number' ? capacity : undefined,
    attention:
      (fside === 'l' || fside === 'r') && typeof fnum === 'number'
        ? { side: sideFromChar(fside), unum: fnum }
        : undefined,
    counts: typeof p['kick'] === 'number' ? convertCounts(p) : undefined,
  };
}

function convertCounts(p: Json): CommandCounts {
  const changeFocus = p['change_focus'];
  return {
    kick: num(p['kick']),
    dash: num(p['dash']),
    turn: num(p['turn']),
    catch: num(p['catch']),
    move: num(p['move']),
    turnNeck: num(p['turn_neck']),
    changeView: num(p['change_view']),
    say: num(p['say']),
    tackle: num(p['tackle']),
    pointto: num(p['pointto']),
    attentionto: num(p['attentionto']),
    changeFocus: typeof changeFocus === 'number' ? changeFocus : undefined,
  };
}

function convertPlayMode(body: unknown, sink: RecordSink, warn: Warn): void {
  if (!isObject(body) || typeof body['mode'] !== 'string') {
    warn('playmode without mode');
    return;
  }
  const mode = playModeFromString(body['mode']);
  if (mode === PlayMode.Null) {
    warn(`unknown play mode "${body['mode']}"`);
  }
  sink({ type: 'playMode', time: num(body['time']), stime: num(body['stime']), mode });
}

function convertTeam(body: unknown, sink: RecordSink, warn: Warn): void {
  if (!isObject(body) || !isObject(body['l']) || !isObject(body['r'])) {
    warn('team without l / r');
    return;
  }
  sink({
    type: 'team',
    time: num(body['time']),
    stime: num(body['stime']),
    teams: [convertTeamInfo(body['l']), convertTeamInfo(body['r'])],
  });
}

function convertTeamInfo(t: Json): TeamInfo {
  const name = t['name'];
  return {
    name: typeof name === 'string' ? name : '',
    score: num(t['score']),
    penScore: num(t['pen_score']),
    penMiss: num(t['pen_miss']),
  };
}

function convertMsg(body: unknown, sink: RecordSink, warn: Warn): void {
  if (!isObject(body) || typeof body['message'] !== 'string') {
    warn('msg without message');
    return;
  }
  sink({
    type: 'msg',
    time: num(body['time']),
    stime: num(body['stime']),
    board: num(body['board']),
    message: body['message'],
  });
}

function convertTeamGraphic(body: unknown, sink: RecordSink, warn: Warn): void {
  if (
    !isObject(body) ||
    (body['side'] !== 'l' && body['side'] !== 'r') ||
    typeof body['x'] !== 'number' ||
    typeof body['y'] !== 'number' ||
    !Array.isArray(body['xpm'])
  ) {
    warn('illegal team_graphic');
    return;
  }
  sink({
    type: 'teamGraphic',
    side: body['side'] as SideChar,
    x: body['x'],
    y: body['y'],
    xpm: body['xpm'].map(String),
  });
}

function toParams(body: unknown): Record<string, ParamValue> | undefined {
  if (!isObject(body)) {
    return undefined;
  }
  const out: Record<string, ParamValue> = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
      out[k] = v;
    }
  }
  return out;
}

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

#!/usr/bin/env python3
"""Synthesize small game logs with a penalty shoot-out.

Usage:
    python3 -I tools/fixtures/make_pk_fixtures.py test/fixtures

Neither of the real logs the other fixtures come from has a penalty
shoot-out, so this script builds one from json-sample.rcg.gz and
text-v5-sample.rcg.gz in the same directory: their header records (version,
parameters, player types; no team graphics), and their last show as the
template of every frame.

The shoot-out has five kicks per team, left first:
    left  o x o o o  (4)
    right o o x o x  (3)
Each kick shows one frame in each of penalty_setup, penalty_ready,
penalty_taken and penalty_score / penalty_miss, one cycle apart. A team
record with the updated penalty counts follows each penalty_score /
penalty_miss play mode, as the server writes it. The outputs are gzip files
written with mtime 0, so regenerating them gives identical bytes.
"""

import gzip
import io
import json
import os
import sys

KICKS = [('l', True), ('r', True),
         ('l', False), ('r', True),
         ('l', True), ('r', False),
         ('l', True), ('r', True),
         ('l', True), ('r', False)]

START = 6000          # first cycle of the shoot-out
NAMES = None          # set from the source logs


def schedule():
    """Yields (time, event) with event = ('mode', name) | ('team', counts) | ('show',)."""
    pen = {'l': [0, 0], 'r': [0, 0]}      # side -> [score, miss]
    kicked = set()
    t = START - 2
    yield t, ('mode', 'play_on')
    yield t, ('show',)
    t += 1
    yield t, ('show',)
    t += 1
    for side, scored in KICKS:
        for phase in ('setup', 'ready', 'taken'):
            yield t, ('mode', f'penalty_{phase}_{side}')
            yield t, ('show',)
            t += 1
        yield t, ('mode', f'penalty_{"score" if scored else "miss"}_{side}')
        pen[side][0 if scored else 1] += 1
        kicked.add(side)
        yield t, ('team', {s: list(v) for s, v in pen.items() if s in kicked})
        yield t, ('show',)
        t += 1
    yield t, ('mode', 'time_over')
    yield t, ('show',)
    yield t, ('result',)


def write_gzip(path, text):
    raw = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as g:
        g.write(text.encode('utf-8'))
    with open(path, 'wb') as f:
        f.write(raw.getvalue())
    return len(text), os.path.getsize(path)


def make_json(src, out):
    header, last_show, names = [], None, None
    with gzip.open(src, 'rt', encoding='utf-8') as f:
        for line in f:
            s = line.strip().rstrip(',')
            if s in ('', '[', ']'):
                continue
            key = next(iter(json.loads(s)))
            if key in ('version', 'timestamp', 'server_param', 'player_param', 'player_type'):
                header.append(s)
            elif key == 'show':
                last_show = json.loads(s)['show']
            elif key == 'team':
                t = json.loads(s)['team']
                names = (t['l']['name'], t['r']['name'])

    def team(time, pen):
        rec = {'time': time}
        for i, side in enumerate(('l', 'r')):
            info = {'name': names[i], 'score': 0}
            if side in pen:
                info['pen_score'], info['pen_miss'] = pen[side]
            rec[side] = info
        return json.dumps({'team': rec}, separators=(',', ':'))

    records = list(header)
    records.append(team(START - 2, {}))
    final_pen = {}
    for time, ev in schedule():
        if ev[0] == 'mode':
            records.append(json.dumps({'playmode': {'time': time, 'mode': ev[1]}},
                                      separators=(',', ':')))
        elif ev[0] == 'team':
            final_pen = ev[1]
            records.append(team(time, ev[1]))
        elif ev[0] == 'show':
            show = dict(last_show)
            show['time'] = time
            show.pop('stime', None)
            records.append(json.dumps({'show': show}, separators=(',', ':')))
        elif ev[0] == 'result':
            records.append(json.dumps({'msg': {'time': time, 'board': 1, 'message':
                                       f'(result 000000000000 {names[0]}_0-vs-{names[1]}_0)'}},
                                      separators=(',', ':')))
            records.append(team(time, final_pen))
    text = '[\n' + ',\n'.join(records) + '\n]\n'
    return write_gzip(out, text)


def make_text(src, out):
    header, last_show, names = [], None, None
    with gzip.open(src, 'rt', encoding='utf-8') as f:
        for line in f:
            s = line.rstrip('\n')
            if not s.startswith('('):
                header.append(s)                       # ULG5
                continue
            key = s[1:].split(' ', 1)[0]
            if key in ('server_param', 'player_param', 'player_type'):
                header.append(s)
            elif key == 'show':
                last_show = s
            elif key == 'team':
                parts = s.strip('()').split()
                names = (parts[2], parts[3])
    body = last_show[len('(show '):]
    body = body[body.index(' '):]                      # drop the time

    def team(time, pen):
        line = f'(team {time} {names[0]} {names[1]} 0 0'
        if pen:
            for side in ('l', 'r'):
                score, miss = pen.get(side, [0, 0])
                line += f' {score} {miss}'
        return line + ')'

    lines = list(header)
    lines.append(team(START - 2, {}))
    final_pen = {}
    for time, ev in schedule():
        if ev[0] == 'mode':
            lines.append(f'(playmode {time} {ev[1]})')
        elif ev[0] == 'team':
            final_pen = ev[1]
            lines.append(team(time, ev[1]))
        elif ev[0] == 'show':
            lines.append(f'(show {time}{body}')
        elif ev[0] == 'result':
            lines.append(f'(msg {time} 1 "(result 000000000000 {names[0]}_0-vs-{names[1]}_0)")')
            lines.append(team(time, final_pen))
    return write_gzip(out, '\n'.join(lines) + '\n')


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    d = sys.argv[1]
    for name, fn, src in (('json-pk.rcg.gz', make_json, 'json-sample.rcg.gz'),
                          ('text-v5-pk.rcg.gz', make_text, 'text-v5-sample.rcg.gz')):
        out = os.path.join(d, name)
        n, z = fn(os.path.join(d, src), out)
        print(f'{out}: {n} bytes, {z} bytes gzipped')


if __name__ == '__main__':
    main()

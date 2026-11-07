#!/usr/bin/env python3
"""Cut small test fixtures out of full-length rcg game logs.

Usage:
    python3 -I tools/fixtures/make_fixtures.py JSON_RCG_GZ TEXT_RCG_GZ OUT_DIR

Each fixture keeps every header record (version, parameters, player types,
team graphics) and the records whose cycle falls inside a few windows.
When a window starts, the latest playmode and team records seen before it
are carried over, so every kept frame still has the play mode and score it
had in the original log.  The outputs are gzip files written with mtime 0,
so regenerating them from the same input gives identical bytes.
"""

import gzip
import io
import json
import os
import sys

JSON_WINDOWS = [
    (1, 200),      # kick-off and the first 200 cycles
    (1740, 1760),  # foul_charge_l at 1746 (stoppage time, stime > 0)
    (2995, 3005),  # half time and kick_off_r at 3001
    (5995, 6000),  # time_over, the result msg and the final team record
]

TEXT_WINDOWS = [
    (1, 200),      # kick-off and the first 200 cycles
    (785, 795),    # offside_r at 789: the show line repeats 30 times
    (6705, 6720),  # goal_l at 6713 (score 1-0): the show line repeats 51 times
    (7995, 8000),  # time_over, the result msg and the final team record
]

JSON_HEADER_KEYS = {'version', 'timestamp', 'server_param', 'player_param',
                    'player_type', 'team_graphic'}
TEXT_HEADER_KEYS = {'server_param', 'player_param', 'player_type'}


def in_windows(time, windows):
    return any(lo <= time <= hi for lo, hi in windows)


def window_start(time, windows):
    return any(time == lo for lo, _ in windows)


def select(records, windows):
    """records: list of (kind, time or None, payload).  Returns kept payloads."""
    kept = []
    last = {}            # kind -> payload of the latest playmode / team record
    emitted = set()      # id() of carried-over payloads already written
    started = set()
    for kind, time, payload in records:
        if time is None:
            kept.append(payload)
            continue
        if in_windows(time, windows):
            lo = next(lo for lo, hi in windows if lo <= time <= hi)
            if lo not in started:
                started.add(lo)
                for k in ('playmode', 'team'):
                    p = last.get(k)
                    if p is not None and id(p) not in emitted and k != kind:
                        kept.append(p)
                        emitted.add(id(p))
            kept.append(payload)
            emitted.add(id(payload))
        if kind in ('playmode', 'team'):
            last[kind] = payload
    return kept


def read_json_records(path):
    records = []
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        for line in f:
            s = line.strip()
            if s in ('', '[', ']'):
                continue
            if s.endswith(','):
                s = s[:-1]
            rec = json.loads(s)
            kind = next(iter(rec))
            body = rec[kind]
            time = None
            if kind not in JSON_HEADER_KEYS:
                time = body['time']
            records.append((kind, time, s))
    return records


def read_text_records(path):
    records = []
    with gzip.open(path, 'rt', encoding='utf-8', errors='surrogateescape') as f:
        for line in f:
            s = line.rstrip('\n')
            if not s.startswith('('):
                records.append(('header', None, s))       # "ULG5"
                continue
            kind = s[1:].split(' ', 1)[0].split('(', 1)[0]
            if kind in TEXT_HEADER_KEYS:
                records.append((kind, None, s))
                continue
            time = int(s.split()[1])
            if kind == 'msg' and time == 0:
                records.append((kind, None, s))           # team graphics
                continue
            records.append((kind, time, s))
    return records


def write_gzip(path, text):
    raw = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as g:
        g.write(text.encode('utf-8', errors='surrogateescape'))
    with open(path, 'wb') as f:
        f.write(raw.getvalue())
    return len(text), os.path.getsize(path)


def summarize(name, kept_lines, kind_of):
    counts = {}
    for s in kept_lines:
        k = kind_of(s)
        counts[k] = counts.get(k, 0) + 1
    print(f'{name}: ' + ', '.join(f'{k}={v}' for k, v in sorted(counts.items())))


def main():
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)
    json_src, text_src, out_dir = sys.argv[1:]
    os.makedirs(out_dir, exist_ok=True)

    kept = select(read_json_records(json_src), JSON_WINDOWS)
    text = '[\n' + ',\n'.join(kept) + '\n]\n'
    out = os.path.join(out_dir, 'json-sample.rcg.gz')
    n, z = write_gzip(out, text)
    print(f'{out}: {n} bytes, {z} bytes gzipped')
    summarize('json-sample', kept, lambda s: next(iter(json.loads(s))))

    kept = select(read_text_records(text_src), TEXT_WINDOWS)
    text = '\n'.join(kept) + '\n'
    out = os.path.join(out_dir, 'text-v5-sample.rcg.gz')
    n, z = write_gzip(out, text)
    print(f'{out}: {n} bytes, {z} bytes gzipped')
    summarize('text-v5-sample', kept,
              lambda s: s[1:].split(' ', 1)[0] if s.startswith('(') else s)


if __name__ == '__main__':
    main()

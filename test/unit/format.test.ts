import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectRcgFormat, isGzip, isSupportedFormat, type RcgFormat } from '../../src/io/format';
import { decompressIfGzip } from '../../src/io/gzip';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
const ascii = (s: string) => new TextEncoder().encode(s);

describe('detectRcgFormat', () => {
  const cases: [string, Uint8Array, RcgFormat][] = [
    ['JSON', ascii('[\n{"version":"19.0.0"}'), { kind: 'json' }],
    [
      'JSON after a BOM and spaces',
      new Uint8Array([0xef, 0xbb, 0xbf, 0x20, 0x0a, 0x5b]),
      { kind: 'json' },
    ],
    ['text v4', ascii('ULG4\n'), { kind: 'text', version: 4 }],
    ['text v5', ascii('ULG5\n'), { kind: 'text', version: 5 }],
    ['text v6', ascii('ULG6\n'), { kind: 'text', version: 6 }],
    ['binary v2', new Uint8Array([0x55, 0x4c, 0x47, 2]), { kind: 'binary', version: 2 }],
    ['binary v3', new Uint8Array([0x55, 0x4c, 0x47, 3]), { kind: 'binary', version: 3 }],
    ['ULG with an unknown version', ascii('ULG7'), { kind: 'unknown' }],
    ['headerless binary v1', new Uint8Array([0, 1, 0, 0]), { kind: 'binary', version: 1 }],
    ['empty input', new Uint8Array(), { kind: 'unknown' }],
  ];
  it.each(cases)('%s', (_, bytes, expected) => {
    expect(detectRcgFormat(bytes)).toEqual(expected);
  });

  it('supports only JSON and text logs', () => {
    expect(isSupportedFormat({ kind: 'json' })).toBe(true);
    expect(isSupportedFormat({ kind: 'text', version: 6 })).toBe(true);
    expect(isSupportedFormat({ kind: 'binary', version: 3 })).toBe(false);
    expect(isSupportedFormat({ kind: 'unknown' })).toBe(false);
  });
});

describe('fixtures', () => {
  it('json-sample.rcg.gz is a gzipped JSON log', async () => {
    const raw = fixture('json-sample.rcg.gz');
    expect(isGzip(raw)).toBe(true);
    const bytes = await decompressIfGzip(raw);
    expect(bytes.length).toBe(2_335_974);
    expect(detectRcgFormat(bytes)).toEqual({ kind: 'json' });
  });

  it('text-v5-sample.rcg.gz is a gzipped text v5 log', async () => {
    const raw = fixture('text-v5-sample.rcg.gz');
    expect(isGzip(raw)).toBe(true);
    const bytes = await decompressIfGzip(raw);
    expect(bytes.length).toBe(1_117_172);
    expect(detectRcgFormat(bytes)).toEqual({ kind: 'text', version: 5 });
  });

  it('leaves uncompressed data unchanged', async () => {
    const bytes = ascii('ULG5\n');
    expect(await decompressIfGzip(bytes)).toBe(bytes);
  });
});

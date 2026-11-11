import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { formatBytes } from '../../src/core/number-format';
import {
  fetchLog,
  HttpError,
  isMixedContent,
  logNameFromUrl,
  parseLogUrl,
} from '../../src/io/fetch-log';
import { fixture, loadBytes } from './helpers';

const PAGE = 'https://example.github.io/rcssmonitor-web/';

describe('parseLogUrl', () => {
  it('takes http and https URLs, and URLs relative to the page', () => {
    expect(parseLogUrl(' https://logs.example.org/a/game.rcg.gz ', PAGE).href).toBe(
      'https://logs.example.org/a/game.rcg.gz',
    );
    expect(parseLogUrl('http://192.168.0.10:8000/game.rcg', PAGE).href).toBe(
      'http://192.168.0.10:8000/game.rcg',
    );
    expect(parseLogUrl('logs/game.rcg.gz', PAGE).href).toBe(
      'https://example.github.io/rcssmonitor-web/logs/game.rcg.gz',
    );
    expect(parseLogUrl('/logs/game.rcg.gz?x=1', PAGE).href).toBe(
      'https://example.github.io/logs/game.rcg.gz?x=1',
    );
  });

  it('refuses what fetch() cannot read', () => {
    expect(() => parseLogUrl('', PAGE)).toThrow('no URL given');
    expect(() => parseLogUrl('   ', PAGE)).toThrow('no URL given');
    expect(() => parseLogUrl('http://', PAGE)).toThrow('not a URL: http://');
    expect(() => parseLogUrl('javascript:alert(1)', PAGE)).toThrow(
      'not an http:// or https:// URL: javascript:alert(1)',
    );
    expect(() => parseLogUrl('ftp://example.org/game.rcg', PAGE)).toThrow('not an http://');
    expect(() => parseLogUrl('data:,abc', PAGE)).toThrow('not an http://');
    expect(() => parseLogUrl('https://user:pw@example.org/game.rcg', PAGE)).toThrow(
      'user name or password',
    );
    // From the single-file HTML on disk, a relative URL is a file:// URL.
    expect(() => parseLogUrl('game.rcg', 'file:///home/user/rcssmonitor-web.html')).toThrow(
      'not an http:// or https:// URL: game.rcg',
    );
  });
});

describe('logNameFromUrl', () => {
  const name = (url: string) => logNameFromUrl(new URL(url));

  it('is the last part of the path, decoded', () => {
    expect(name('https://example.org/logs/game.rcg.gz?raw=1#x')).toBe('game.rcg.gz');
    expect(name('https://example.org/logs/HELIOS%20vs%20CYRUS.rcg')).toBe('HELIOS vs CYRUS.rcg');
    expect(name('https://example.org/logs/')).toBe('logs');
  });

  it('falls back to the host, or the raw text if it cannot be decoded', () => {
    expect(name('https://example.org:8080/')).toBe('example.org:8080');
    expect(name('https://example.org/%E0%A4%A.rcg')).toBe('%E0%A4%A.rcg');
  });
});

describe('isMixedContent', () => {
  const mixed = (url: string, page = PAGE) => isMixedContent(new URL(url), page);

  it('blocks http:// to other machines from an https page', () => {
    expect(mixed('http://192.168.0.10/game.rcg')).toBe(true);
    expect(mixed('http://logs.example.org/game.rcg')).toBe(true);
  });

  it('allows https, the local machine, and pages not served over https', () => {
    expect(mixed('https://logs.example.org/game.rcg')).toBe(false);
    for (const host of ['localhost', 'a.localhost', '127.0.0.1', '127.1.2.3', '[::1]']) {
      expect(mixed(`http://${host}:8000/game.rcg`)).toBe(false);
    }
    expect(mixed('http://192.168.0.10/game.rcg', 'file:///home/user/rcssmonitor-web.html')).toBe(
      false,
    );
    expect(mixed('http://192.168.0.10/game.rcg', 'http://localhost:5173/')).toBe(false);
  });
});

describe('fetchLog', () => {
  let server: Server | null = null;
  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined));
    server = null;
  });

  async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void) {
    server = createServer(handler);
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return (path: string) => new URL(`http://127.0.0.1:${port}${path}`);
  }

  const gz = fixture('json-sample.rcg.gz');

  it('downloads a log with progress, and the bytes load as from a file', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': gz.length });
      // In pieces, so that progress is reported more than once.
      const half = Math.floor(gz.length / 2);
      res.write(gz.subarray(0, half));
      setTimeout(() => res.end(gz.subarray(half)), 20);
    });
    const progress: [number, number | undefined][] = [];
    const buffer = await fetchLog(url('/logs/json-sample.rcg.gz'), {
      progress: (received, total) => progress.push([received, total]),
    });
    expect(new Uint8Array(buffer)).toEqual(gz);
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)).toEqual([gz.length, gz.length]);
    for (let i = 1; i < progress.length; ++i) {
      expect(progress[i]?.[0]).toBeGreaterThan(progress[i - 1]?.[0] ?? 0);
    }
    const loaded = await loadBytes(new Uint8Array(buffer));
    expect(loaded.store.frameCount).toBe(267);
  });

  it('gives no total without Content-Length', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/gzip' });
      res.end(gz);
    });
    const totals = new Set<number | undefined>();
    const buffer = await fetchLog(url('/game.rcg.gz'), {
      progress: (_received, total) => totals.add(total),
    });
    expect(buffer.byteLength).toBe(gz.length);
    expect([...totals]).toEqual([undefined]);
  });

  it('reads a log the server compresses on the way, past the total it gave', async () => {
    // The text of the log, compressed only for the transfer.
    const text = gunzipSync(gz);
    const body = gzipSync(text);
    const url = await serve((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Encoding': 'gzip',
        'Content-Length': body.length,
      });
      res.end(body);
    });
    let last: [number, number | undefined] = [0, 0];
    const buffer = await fetchLog(url('/game.rcg'), {
      progress: (received, total) => (last = [received, total]),
    });
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array(text));
    expect(last).toEqual([text.length, body.length]);
    expect((await loadBytes(new Uint8Array(buffer))).store.frameCount).toBe(267);
  });

  it('rejects with the HTTP status of an error', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(404, 'Not Found');
      res.end('no such log');
    });
    const error = await fetchLog(url('/missing.rcg')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
    expect((error as HttpError).message).toBe('HTTP 404 Not Found');
  });

  it('stops when aborted', async () => {
    const url = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Length': gz.length });
      res.write(gz.subarray(0, 100));
      // The rest never comes.
    });
    const controller = new AbortController();
    const download = fetchLog(url('/slow.rcg.gz'), {
      signal: controller.signal,
      progress: () => controller.abort(),
    });
    await expect(download).rejects.toMatchObject({ name: 'AbortError' });
    server?.closeAllConnections();
  });

  it('rejects with a TypeError when nothing answers', async () => {
    const url = await serve(() => {});
    const unused = url('/game.rcg');
    await new Promise((resolve) => server?.close(resolve));
    server = null;
    await expect(fetchLog(unused)).rejects.toBeInstanceOf(TypeError);
  });
});

describe('formatBytes', () => {
  it('uses SI units with one decimal', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1000)).toBe('1.0 kB');
    expect(formatBytes(123_456)).toBe('123.5 kB');
    expect(formatBytes(999_949)).toBe('999.9 kB');
    expect(formatBytes(999_950)).toBe('1.0 MB');
    expect(formatBytes(12_345_678)).toBe('12.3 MB');
  });
});

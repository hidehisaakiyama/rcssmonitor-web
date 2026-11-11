import { readFileSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { ReplayServer } from '../../tools/replay-server/replay-server';
import { fixture, openApp, requireBuild } from './helpers';

// Opening a log from a URL: the page is the single-file build on file://, the
// log is on an HTTP server at another port, so it is another site's file.
requireBuild();

interface LogServer {
  /** The URL of a path on the server. */
  url(path: string): string;
  /** The paths requested, in order. */
  readonly requests: string[];
  /** Responses held back by /slow/ paths, until the test ends. */
  readonly held: ServerResponse[];
}

let server: Server | null = null;
let replay: ReplayServer | null = null;
test.afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined));
  server = null;
  await replay?.close();
  replay = null;
});

/**
 * Serves the fixtures under /logs/. With `cors`, it lets other sites read
 * them. /slow/NAME sends the first kilobyte of NAME and then waits.
 */
async function startServer(cors = true): Promise<LogServer> {
  const requests: string[] = [];
  const held: ServerResponse[] = [];
  server = createServer((req, res) => {
    const path = req.url ?? '/';
    requests.push(path);
    const headers: Record<string, string | number> = cors
      ? { 'Access-Control-Allow-Origin': '*' }
      : {};
    const m = /^\/(logs|slow)\/([\w.-]+)$/.exec(path);
    let body: Buffer;
    try {
      body = readFileSync(fixture(m?.[2] ?? '-'));
    } catch {
      res.writeHead(404, 'Not Found', headers);
      res.end('no such log');
      return;
    }
    res.writeHead(200, {
      ...headers,
      'Content-Type': 'application/gzip',
      'Content-Length': body.length,
    });
    if (m?.[1] === 'slow') {
      res.write(body.subarray(0, 1024));
      held.push(res);
    } else {
      res.end(body);
    }
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: (p) => `http://127.0.0.1:${port}${p}`, requests, held };
}

const result = (page: Page) => page.locator('#load-result');
const link = (page: Page) => page.locator('#status-link');

async function openUrlDialog(page: Page): Promise<void> {
  await page.locator('#menu-file').click();
  await page.locator('#file-open-url').click();
  await expect(page.locator('#open-url-dialog')).toBeVisible();
}

test('opens a log from a URL with the File menu', async ({ page }) => {
  const logs = await startServer();
  await openApp(page);
  await openUrlDialog(page);
  await expect(page.locator('#open-url')).toBeFocused();
  await expect(page.locator('#open-url')).toHaveValue('');
  const url = logs.url('/logs/json-sample.rcg.gz');
  await page.locator('#open-url').fill(url);
  await page.locator('#open-url-dialog-ok').click();
  await expect(page.locator('#open-url-dialog')).toHaveCount(0);

  await expect(result(page)).toHaveText(
    'json-sample.rcg.gz: JSON (gzip), 267 frames, cycles 1-6000, HELIOS2023 0-0 CYRUS',
  );
  await expect(page).toHaveTitle('json-sample.rcg.gz - rcssmonitor-web');
  await expect(page.locator('#frame-label')).toHaveText(/^1 \(1 \/ 267\)$/);
  await expect(link(page)).toBeHidden();
  expect(logs.requests).toEqual(['/logs/json-sample.rcg.gz']);

  // The dialog offers the URL again.
  await openUrlDialog(page);
  await expect(page.locator('#open-url')).toHaveValue(url);
  await page.keyboard.press('Escape');
  await expect(page.locator('#open-url-dialog')).toHaveCount(0);
});

test('does not take a URL it cannot open', async ({ page }) => {
  await startServer();
  await openApp(page);
  await openUrlDialog(page);
  const input = page.locator('#open-url');
  for (const text of ['ftp://example.org/game.rcg', 'game.rcg', 'http://']) {
    await input.fill(text);
    await page.locator('#open-url-dialog-ok').click();
    await expect(page.locator('#open-url-dialog')).toBeVisible();
    expect(await input.evaluate((e: HTMLInputElement) => e.validity.valid)).toBe(false);
  }
  // From file://, the browser lets the page read http:// URLs.
  await expect(page.locator('#open-url-warning')).toBeHidden();
  await page.locator('#open-url-dialog button[value="cancel"]').click();
  await expect(page.locator('#open-url-dialog')).toHaveCount(0);
  await expect(result(page)).toContainText('Open a game log');
});

test('opens the log of ?log= at start-up instead of connecting', async ({ page }) => {
  const logs = await startServer();
  const url = logs.url('/logs/text-v5-sample.rcg.gz');
  await openApp(page, `?log=${encodeURIComponent(url)}&connect=1&host=127.0.0.1&port=9`);
  await expect(result(page)).toHaveText(
    'text-v5-sample.rcg.gz: text v5 (gzip), 312 frames, cycles 1-8000, HELIOS2022 1-0 CYRUS',
  );
  await expect(page.locator('#connection-status')).toBeHidden();
  await openUrlDialog(page);
  await expect(page.locator('#open-url')).toHaveValue(url);
});

test('asks to download a log the server does not let the page read', async ({ page }) => {
  const logs = await startServer(false);
  const url = logs.url('/logs/json-sample.rcg.gz');
  await openApp(page, `?log=${encodeURIComponent(url)}`);
  await expect(result(page)).toHaveText(
    'Cannot read json-sample.rcg.gz: the server may not let other sites read it, ' +
      'or it cannot be reached. Download it and open the file.',
  );
  await expect(link(page)).toBeVisible();
  await expect(link(page)).toHaveText('Download');
  await expect(link(page)).toHaveAttribute('href', url);
  await expect(link(page)).toHaveAttribute('target', '_blank');
  await expect(page.locator('#load-progress')).toBeHidden();
  expect(logs.requests).toEqual(['/logs/json-sample.rcg.gz']);

  // The link opens the URL in a new tab, where the browser saves the file.
  const [download] = await Promise.all([page.waitForEvent('download'), link(page).click()]);
  expect(download.url()).toBe(url);
  await download.cancel();

  // The saved file opens as any other; the link goes away.
  await page.setInputFiles('#rcg-file', fixture('json-sample.rcg.gz'));
  await expect(result(page)).toContainText('267 frames');
  await expect(link(page)).toBeHidden();
});

test('tells the HTTP status of a log the server does not have', async ({ page }) => {
  const logs = await startServer();
  await openApp(page, `?log=${encodeURIComponent(logs.url('/logs/missing.rcg'))}`);
  await expect(result(page)).toHaveText('missing.rcg: HTTP 404 Not Found');
  await expect(link(page)).toBeHidden();
});

test('shows the download, and gives it up for a file', async ({ page }) => {
  const logs = await startServer();
  await openApp(page, `?log=${encodeURIComponent(logs.url('/slow/json-sample.rcg.gz'))}`);
  await expect(result(page)).toHaveText(/^Downloading json-sample\.rcg\.gz… \d+%$/);
  await expect(page.locator('#load-progress')).toBeVisible();
  expect(logs.held).toHaveLength(1);

  await page.setInputFiles('#rcg-file', fixture('text-v5-sample.rcg.gz'));
  await expect(result(page)).toHaveText(/^text-v5-sample\.rcg\.gz: text v5/);
  await expect(page.locator('#load-progress')).toBeHidden();
  // The download stopped: the browser closed its request.
  await expect.poll(() => logs.held[0]?.destroyed || logs.held[0]?.req.destroyed).toBe(true);
  await expect(page).toHaveTitle('text-v5-sample.rcg.gz - rcssmonitor-web');
});

test('gives up the download to connect to a server', async ({ page }) => {
  const logs = await startServer();
  replay = await ReplayServer.fromFile(fixture('json-sample.rcg.gz'), {
    host: '127.0.0.1',
    interval: 20,
  });
  const port = await replay.listen();
  await openApp(page, `?log=${encodeURIComponent(logs.url('/slow/json-pk.rcg.gz'))}`);
  await expect(result(page)).toHaveText(/^Downloading json-pk\.rcg\.gz…/);

  await page.locator('#connect-button').click();
  await page.locator('#connect-host').fill('127.0.0.1');
  await page.locator('#connect-port').fill(String(port));
  await page.locator('#connect-dialog-ok').click();
  await expect(page.locator('#connection-status')).toHaveText(
    `Connected: ws://127.0.0.1:${port}/monitor`,
  );
  await expect(result(page)).toHaveText(`Live game from ws://127.0.0.1:${port}/monitor`);
  await expect(page.locator('#load-progress')).toBeHidden();
  await expect.poll(() => logs.held[0]?.destroyed || logs.held[0]?.req.destroyed).toBe(true);
});

/**
 * Answers for GitHub's hosts from the fixtures, as they answer for a public
 * repository o/r: the raw file, or with `lfs` a Git LFS pointer there and
 * the file on the media host (404 there otherwise). Records the URLs asked.
 */
async function routeGitHub(page: Page, lfs: boolean): Promise<string[]> {
  const asked: string[] = [];
  const cors = { 'Access-Control-Allow-Origin': '*' };
  await page.route(/^https:\/\/([\w-]+\.)?github(usercontent)?\.com\//, async (route) => {
    const url = route.request().url();
    asked.push(url);
    const m =
      /^https:\/\/(raw|media)\.githubusercontent\.com\/(?:media\/)?o\/r\/main\/logs\/([\w.-]+)$/.exec(
        url,
      );
    if (!m?.[2] || (m[1] === 'media' && !lfs)) {
      // Pages on github.com come without CORS, as they do there.
      await route.fulfill({ status: m ? 404 : 200, headers: m ? cors : {}, body: '' });
      return;
    }
    const body = readFileSync(fixture(m[2]));
    const pointer =
      'version https://git-lfs.github.com/spec/v1\n' +
      `oid sha256:${'0'.repeat(64)}\nsize ${body.length}\n`;
    await route.fulfill(
      m[1] === 'raw' && lfs
        ? { headers: { ...cors, 'Content-Type': 'text/plain' }, body: pointer }
        : { headers: { ...cors, 'Content-Type': 'application/octet-stream' }, body },
    );
  });
  return asked;
}

test('opens a log stored with Git LFS from its GitHub file page', async ({ page }) => {
  await openApp(page);
  const asked = await routeGitHub(page, true);
  await openUrlDialog(page);
  const blob = 'https://github.com/o/r/blob/main/logs/json-sample.rcg.gz';
  await page.locator('#open-url').fill(blob);
  await page.locator('#open-url-dialog-ok').click();
  await expect(result(page)).toHaveText(
    'json-sample.rcg.gz: JSON (gzip), 267 frames, cycles 1-6000, HELIOS2023 0-0 CYRUS',
  );
  expect(asked).toEqual([
    'https://raw.githubusercontent.com/o/r/main/logs/json-sample.rcg.gz',
    'https://media.githubusercontent.com/media/o/r/main/logs/json-sample.rcg.gz',
  ]);
  // The dialog offers what was typed.
  await openUrlDialog(page);
  await expect(page.locator('#open-url')).toHaveValue(blob);
});

test('opens the GitHub raw link of ?log= from raw.githubusercontent.com', async ({ page }) => {
  // Routes are per page: set them up on a blank page, then open the app.
  const asked = await routeGitHub(page, false);
  const link = 'https://github.com/o/r/raw/main/logs/text-v5-sample.rcg.gz';
  await openApp(page, `?log=${encodeURIComponent(link)}`);
  await expect(result(page)).toHaveText(/^text-v5-sample\.rcg\.gz: text v5 \(gzip\), 312 frames/);
  expect(asked).toEqual(['https://raw.githubusercontent.com/o/r/main/logs/text-v5-sample.rcg.gz']);
});

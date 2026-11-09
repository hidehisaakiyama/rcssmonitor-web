import { expect, test, type Page } from '@playwright/test';
import { Side } from '../../src/core/constants';
import type { Vec2 } from '../../src/core/geometry';
import { dispFoul } from '../../src/io/live/commands';
import type { FieldView } from '../../src/ui/field-view';
import { ReplayServer, type ReplayServerOptions } from '../../tools/replay-server/replay-server';
import { fixture, openApp, requireBuild } from './helpers';

// The live connection against the replay server: connect, receive, follow
// the game, disconnect, and send the referee commands.
requireBuild();

let server: ReplayServer | null = null;
test.afterEach(async () => {
  await server?.close();
  server = null;
});

async function startServer(options: ReplayServerOptions = {}) {
  server = await ReplayServer.fromFile(fixture('json-sample.rcg.gz'), {
    host: '127.0.0.1',
    interval: 20,
    ...options,
  });
  return { server, port: await server.listen() };
}

const commands = () => server?.commands.map((c) => c.text) ?? [];
const status = (page: Page) => page.locator('#connection-status');
const label = (page: Page) => page.locator('#frame-label');
const liveButton = (page: Page) => page.locator('#live-button');

/** "time (i / n)" of the frame label. */
async function position(page: Page): Promise<{ index: number; count: number }> {
  const m = /\((\d+) \/ (\d+)\)/.exec((await label(page).textContent()) ?? '');
  return { index: Number(m?.[1] ?? 0), count: Number(m?.[2] ?? 0) };
}

async function connectWithUrl(page: Page, port: number, extra = ''): Promise<void> {
  await openApp(page, `?connect=1&host=127.0.0.1&port=${port}${extra}`);
  await expect(status(page)).toHaveText(`Connected: ws://127.0.0.1:${port}/monitor`);
}

test('connects with the dialog, follows the game and disconnects', async ({ page }) => {
  const { port } = await startServer();
  await openApp(page);
  await expect(page.locator('#kick-off-button')).toBeDisabled();
  await expect(page.locator('#disconnect-button')).toBeDisabled();

  await page.locator('#connect-button').click();
  const dialog = page.locator('#connect-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#connect-host')).toHaveValue('localhost');
  await expect(page.locator('#connect-port')).toHaveValue('6080');
  await expect(page.locator('#connect-reconnect-wait')).toBeDisabled();
  await page.locator('#connect-host').fill('127.0.0.1');
  await page.locator('#connect-port').fill(String(port));
  await page.locator('#connect-dialog-ok').click();
  await expect(dialog).toHaveCount(0);

  await expect(status(page)).toHaveText(`Connected: ws://127.0.0.1:${port}/monitor`);
  await expect(page).toHaveTitle(`ws://127.0.0.1:${port}/monitor - rcssmonitor-web`);
  await expect(page.locator('#load-result')).toHaveText(
    `Live game from ws://127.0.0.1:${port}/monitor`,
  );
  await expect(liveButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#connect-button')).toBeDisabled();
  // Following the newest frame.
  await expect.poll(async () => (await position(page)).count).toBeGreaterThan(10);
  let p = await position(page);
  expect(p.index).toBe(p.count);

  // Stepping back leaves the live mode; the frames keep coming.
  await page.keyboard.press('ArrowLeft');
  await expect(liveButton(page)).toHaveAttribute('aria-pressed', 'false');
  const back = await position(page);
  await expect.poll(async () => (await position(page)).count).toBeGreaterThan(back.count + 5);
  expect((await position(page)).index).toBe(back.index);
  // Ctrl+L goes back to the newest frame.
  await page.keyboard.press('Control+l');
  await expect(liveButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await position(page)).count).toBeGreaterThan(back.count + 10);
  p = await position(page);
  expect(p.index).toBeGreaterThan(p.count - 3);

  await page.locator('#kick-off-button').click();
  await page.keyboard.press('Control+k');
  await expect.poll(commands).toEqual(['(dispstart)', '(dispstart)']);

  await page.locator('#disconnect-button').click();
  await expect.poll(commands).toEqual(['(dispstart)', '(dispstart)', '(dispbye)']);
  await expect(status(page)).toBeHidden();
  await expect(page.locator('#connect-button')).toBeEnabled();
  await expect(liveButton(page)).toBeDisabled();
  await expect(liveButton(page)).toHaveAttribute('aria-pressed', 'false');
  // The game stays to look at.
  const stopped = await position(page);
  expect(stopped.count).toBeGreaterThan(10);
  await page.keyboard.press('Home');
  await expect(label(page)).toHaveText(`1 (1 / ${stopped.count})`);
});

test('connects from the URL and reconnects', async ({ page }) => {
  const { server, port } = await startServer({ loop: true });
  await connectWithUrl(page, port, '&auto_reconnect_mode=on');
  server.dropMonitors();
  await expect(status(page)).toHaveText(`Reconnecting: ws://127.0.0.1:${port}/monitor`);
  await expect(status(page)).toHaveText(`Connected: ws://127.0.0.1:${port}/monitor`);
  await expect.poll(() => server.monitorCount).toBe(1);
  // Ctrl+C does nothing while connected.
  await page.keyboard.press('Control+c');
  await expect.poll(() => server.monitorCount).toBe(1);

  await page.locator('#disconnect-button').click();
  await expect.poll(() => server.monitorCount).toBe(0);
  // Ctrl+C connects again to the same server, without the dialog.
  await page.keyboard.press('Control+c');
  await expect(status(page)).toHaveText(`Connected: ws://127.0.0.1:${port}/monitor`);
  await expect(page.locator('#connect-dialog')).toHaveCount(0);
});

test('tells why a connection failed or ended', async ({ page }) => {
  // A file:// page sends "Origin: null".
  const refused = await startServer({ allowedOrigins: ['http://example.invalid'] });
  await openApp(page, `?connect=1&host=127.0.0.1&port=${refused.port}`);
  await expect(page.locator('#status-message')).toHaveText(
    `Failed to connect to ws://127.0.0.1:${refused.port}/monitor. ` +
      'Check server::ws_port and server::ws_allowed_origins.',
  );
  await expect(status(page)).toBeHidden();
  await refused.server.close();

  const { server, port } = await startServer({ maxMonitors: 1, coach: false });
  // Another monitor takes the only place.
  const other = new WebSocket(`ws://127.0.0.1:${port}/monitor`);
  other.onopen = () => other.send('(dispinit version -1)');
  await expect.poll(() => server.monitorCount).toBe(1);
  await openApp(page, `?connect=1&host=127.0.0.1&port=${port}`);
  await expect(page.locator('#status-message')).toHaveText(
    'Connection refused by the server: (error no_more_monitor)',
  );
  other.close();
  await expect.poll(() => server.monitorCount).toBe(0);

  await connectWithUrl(page, port);
  // A reply in a msg: the server is not in the coach mode.
  await page.evaluate(() =>
    (window.rcssmonitorWeb as { live: { send(c: string): boolean } }).live.send(
      '(change_mode play_on)',
    ),
  );
  await expect(page.locator('#status-message')).toHaveText('(error illegal_command_form)');
  // The server goes away.
  server.dropMonitors();
  await expect(page.locator('#status-message')).toHaveText('Disconnected from the server.');
  await expect(status(page)).toBeHidden();
});

/** Right-clicks the field at a point in the window; returns the field coordinates there. */
async function rightClick(page: Page, x: number, y: number): Promise<Vec2> {
  await page.mouse.click(x, y, { button: 'right' });
  await expect(page.locator('#context-menu')).toBeVisible();
  return page.evaluate(
    ({ x, y }) => (window.rcssmonitorWeb as { field: FieldView }).field.fieldAt(x, y),
    { x, y },
  );
}

/** The window coordinates of a field point. */
async function screenOf(page: Page, x: number, y: number): Promise<Vec2> {
  return page.evaluate(
    ({ x, y }) => {
      const field = (window.rcssmonitorWeb as { field: FieldView }).field;
      const r = field.element.getBoundingClientRect();
      const s = field.renderer.fieldToScreen(x, y) ?? { x: 0, y: 0 };
      return { x: r.left + s.x, y: r.top + s.y };
    },
    { x, y },
  );
}

test('sends the referee commands from the pop-up menu', async ({ page }) => {
  const { port } = await startServer({ coach: true });
  await connectWithUrl(page, port);
  await page.keyboard.press('ArrowLeft'); // stay on one frame
  const menu = page.locator('#context-menu');

  let s = await screenOf(page, 10, -5);
  let f = await rightClick(page, s.x, s.y);
  expect(Math.abs(f.x - 10)).toBeLessThan(0.3);
  expect(Math.abs(f.y + 5)).toBeLessThan(0.3);
  await page.locator('#menu-drop-ball').click();
  await expect(menu).toHaveCount(0);
  await expect.poll(commands).toEqual([dispFoul(f.x, f.y, Side.Neutral)]);

  s = await screenOf(page, -20, 10);
  f = await rightClick(page, s.x, s.y);
  await page.locator('#menu-free-kick-right').click();
  await expect.poll(() => commands().at(-1)).toBe(dispFoul(f.x, f.y, Side.Right));

  // The card dialog chooses the player under the mouse.
  const player = await page.evaluate(() => {
    const field = (window.rcssmonitorWeb as { field: FieldView }).field;
    const p = field.gameStore?.frame(field.frameIndex)?.players[2];
    return { x: p?.x ?? 0, y: p?.y ?? 0 };
  });
  s = await screenOf(page, player.x, player.y);
  await rightClick(page, s.x, s.y);
  await page.locator('#menu-yellow-card').click();
  await expect(page.locator('#card-player')).toHaveValue('1 3');
  await page.locator('#card-dialog-ok').click();
  await expect.poll(() => commands().at(-1)).toBe('(dispcard 1 3 yellow)');

  // Or any other player. The frame on the screen depends on how many had
  // arrived, so click outside the pitch, where no player is near.
  s = await screenOf(page, -56, 37);
  await rightClick(page, s.x, s.y);
  await page.locator('#menu-red-card').click();
  await expect(page.locator('#card-player')).toHaveValue('');
  await page.locator('#card-player').selectOption('-1 11');
  await page.locator('#card-dialog-ok').click();
  await expect.poll(() => commands().at(-1)).toBe('(dispcard -1 11 red)');
  // Cancel sends nothing.
  await rightClick(page, s.x, s.y);
  await page.locator('#menu-red-card').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#card-dialog')).toHaveCount(0);

  // Change Playmode puts the ball where the mode needs it.
  s = await screenOf(page, 20, -10);
  await rightClick(page, s.x, s.y);
  await page.locator('#menu-change-playmode').hover();
  await page.locator('#menu-playmode-corner_kick_l').click();
  await expect
    .poll(() => commands().slice(-2))
    .toEqual(['(move (ball) 51.5 -33 0 0 0)', '(change_mode corner_kick_l)']);

  // The keyboard works in the menu, and Escape closes it.
  await rightClick(page, s.x, s.y);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#menu-drop-ball')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(commands()).toHaveLength(6);
});

test('disables the referee commands without a connection or the coach mode', async ({ page }) => {
  await openApp(page);
  await rightClick(page, 300, 300);
  await expect(page.locator('#menu-drop-ball')).toBeDisabled();
  await expect(page.locator('#menu-change-playmode')).toBeDisabled();
  await page.keyboard.press('Escape');

  const { port } = await startServer({ coach: false });
  await connectWithUrl(page, port);
  await rightClick(page, 300, 300);
  await expect(page.locator('#menu-drop-ball')).toBeEnabled();
  await expect(page.locator('#menu-change-playmode')).toBeDisabled();
  await expect(page.locator('#menu-change-playmode')).toHaveAttribute('title', /coach mode/);
});

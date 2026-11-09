import { expect, test, type Page } from '@playwright/test';
import type { ViewState } from '../../src/view/view-state';
import { ReplayServer } from '../../tools/replay-server/replay-server';
import { fixture, loadLog, openApp, requireBuild } from './helpers';

// Phase 6: the 3D view. Headless browsers draw WebGL in software, so these
// tests check the state of the scene, not its pixels.
requireBuild();

interface Renderer {
  kind: '2d' | '3d';
  canvas: HTMLCanvasElement;
  inspect?(): {
    ball: { visible: boolean; x: number; y: number; z: number };
    shadow: { visible: boolean; x: number; y: number; z: number };
    players: number;
    rings: number;
    cards: number;
    viewAreas: number;
    camera: { mode: string; position: { x: number; y: number; z: number } };
    frameIndex: number;
    drawCalls: number;
  };
  fieldToScreen?(x: number, y: number): { x: number; y: number } | null;
}

interface Hook {
  view: ViewState;
  field: { renderer: Renderer; frameIndex: number };
  playback: { index: number };
}

const hook = <T>(page: Page, f: (h: Hook) => T) =>
  page.evaluate(`(${f.toString()})(window.rcssmonitorWeb)`) as Promise<T>;

const kind = (page: Page) => hook(page, (h) => h.field.renderer.kind);
const scene = (page: Page) => hook(page, (h) => h.field.renderer.inspect?.());

/**
 * Waits until the 3D view has drawn. If it does not open, the error says
 * why, as the app tells on the status bar (e.g. no WebGL).
 */
async function wait3d(page: Page): Promise<void> {
  try {
    await expect.poll(() => kind(page)).toBe('3d');
  } catch (e) {
    const why = await page.locator('#status-message').textContent();
    throw new Error(`the 3D view did not open: ${why ?? '(no message)'}`, { cause: e });
  }
  await expect.poll(async () => (await scene(page))?.drawCalls ?? 0).toBeGreaterThan(0);
}

/** A JSON log with the ball 3 m up in frame 1 and on the ground in frame 2. */
const FLYING_BALL = [
  '[',
  '{"show":{"time":1,"ball":{"x":10,"y":-5,"vx":0.5,"vy":0,"z":3,"vz":0.2},"players":[]}},',
  '{"show":{"time":2,"ball":{"x":10.5,"y":-5,"vx":0.5,"vy":0},"players":[]}}',
  ']',
  '',
].join('\n');

test('switches between 2D and 3D, keeping the frame and the selection', async ({ page }) => {
  await openApp(page);
  await loadLog(page, 'json-sample.rcg.gz');
  await hook(page, (h) => {
    h.view.selectPlayer(5);
  });
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');

  await page.keyboard.press('d');
  await wait3d(page);
  await expect(page.locator('#view-3d-button')).toHaveAttribute('aria-pressed', 'true');
  const s = await scene(page);
  expect(s?.players).toBe(22);
  expect(s?.ball.visible).toBe(true);
  // A WebGL canvas took the 2D canvas' place, under the HUD.
  expect(
    await hook(page, (h) => {
      const c = h.field.renderer.canvas;
      return [c.getContext('webgl2') !== null, c.nextElementSibling?.className];
    }),
  ).toEqual([true, 'hud-layer']);
  await expect(page.locator('#frame-label')).toHaveText('5999 (266 / 267)');

  await page.locator('#menu-view').click();
  await expect(page.locator('#view-3d')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#view-3d').click();
  await expect.poll(() => kind(page)).toBe('2d');
  await expect(page.locator('#view-3d-button')).toHaveAttribute('aria-pressed', 'false');
  expect(await hook(page, (h) => [h.playback.index, h.view.selected])).toEqual([
    265,
    { side: 1, unum: 5 },
  ]);

  // The choice is kept.
  await page.locator('#view-3d-button').click();
  await wait3d(page);
  await page.reload();
  await wait3d(page);
});

test('draws the ball at its height, with its shadow on the ground', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('d');
  await wait3d(page);
  await page.setInputFiles('#rcg-file', {
    name: 'flying.rcg',
    mimeType: 'application/json',
    buffer: Buffer.from(FLYING_BALL),
  });
  await expect(page.locator('#load-result')).toContainText('2 frames');
  await expect.poll(async () => (await scene(page))?.ball.y).toBeCloseTo(3.35); // 3 m + radius 0.35
  let s = await scene(page);
  expect([s?.ball.x, s?.ball.z]).toEqual([10, -5]); // field (x, y) is world (X, Z)
  expect(s?.shadow).toEqual({ visible: true, x: 10, y: 0.03, z: -5 });

  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await scene(page))?.ball.y).toBeCloseTo(0.35);
  s = await scene(page);
  expect(s?.shadow.x).toBe(10.5);
});

test('keeps the referee menu and the mouse position in 3D', async ({ page }) => {
  await openApp(page);
  await loadLog(page, 'json-sample.rcg.gz');
  await page.keyboard.press('d');
  await wait3d(page);
  const box = await page.locator('.field-view').boundingBox();
  if (!box) {
    throw new Error('no field view');
  }
  // The center of the canvas looks at the center of the field.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#mouse-pos')).toHaveText(/^\(-?0\.\d\d, -?0\.\d\d\)$/);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await expect(page.locator('#context-menu')).toBeVisible();
  await page.keyboard.press('Escape');

  // The wheel zooms the camera instead of stepping frames.
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(200);
  await expect(page.locator('#frame-label')).toHaveText('1 (1 / 267)');
});

test('interpolates between two frames', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('d');
  await wait3d(page);
  await page.setInputFiles('#rcg-file', {
    name: 'flying.rcg',
    mimeType: 'application/json',
    buffer: Buffer.from(FLYING_BALL),
  });
  await expect(page.locator('#load-result')).toContainText('2 frames');
  // Halfway from frame 1 (x 10, 3 m up) to frame 2 (x 10.5, on the ground).
  await hook(page, (h) => {
    const field = h.field as unknown as {
      position: () => { index: number; alpha: number };
      renderNow(): void;
    };
    field.position = () => ({ index: 0, alpha: 0.5 });
    field.renderNow();
  });
  const s = await scene(page);
  expect(s?.ball.x).toBeCloseTo(10.25);
  expect(s?.ball.y).toBeCloseTo(1.5 + 0.35);
});

test('switches the cameras', async ({ page }) => {
  await openApp(page);
  await loadLog(page, 'json-sample.rcg.gz');
  await page.keyboard.press('d');
  await wait3d(page);
  const camera = async () => (await scene(page))?.camera;
  await expect.poll(async () => (await camera())?.mode).toBe('broadcast');
  await expect(page.locator('#camera-select')).toHaveValue('broadcast');

  await page.locator('#menu-view').click();
  await page.locator('#view-camera').hover();
  await page.locator('#view-camera-top').click();
  await expect.poll(async () => (await camera())?.mode).toBe('top');
  // The whole pitch is in view from above.
  const corners = await hook(page, (h) =>
    [-52.5, 52.5].flatMap((x) => [-34, 34].map((y) => h.field.renderer.fieldToScreen?.(x, y))),
  );
  const box = await page.locator('.field-view').boundingBox();
  for (const c of corners) {
    expect(c?.x).toBeGreaterThan(0);
    expect(c?.x).toBeLessThan(box?.width ?? 0);
    expect(c?.y).toBeGreaterThan(0);
    expect(c?.y).toBeLessThan(box?.height ?? 0);
  }

  await page.keyboard.press('e'); // next: behind the left goal
  await expect(page.locator('#camera-select')).toHaveValue('goal-left');

  // The player camera: a hint without a selected player, then its eyes.
  await page.locator('#camera-select').selectOption('player');
  await expect(page.locator('#status-message')).toContainText('Select a player');
  await page.keyboard.press('5');
  const eye = await hook(page, (h) => {
    const p = (
      h.field as unknown as {
        gameStore: { frame(i: number): { players: { x: number; y: number }[] } };
      }
    ).gameStore.frame(h.field.frameIndex).players[4];
    return { x: p?.x, y: p?.y };
  });
  await expect
    .poll(async () => (await camera())?.position)
    .toEqual({ x: eye.x, y: 1.65, z: eye.y });

  // Dragging the broadcast camera makes it free.
  await page.locator('#camera-select').selectOption('broadcast');
  const fb = await page.locator('.field-view').boundingBox();
  if (!fb) {
    throw new Error('no field view');
  }
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
  await page.mouse.down();
  await page.mouse.move(fb.x + fb.width / 2 + 80, fb.y + fb.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#camera-select')).toHaveValue('free');
  // The choice is kept.
  await page.reload();
  await wait3d(page);
  await expect(page.locator('#camera-select')).toHaveValue('free');
});

test('shows a live game one cycle behind, to move smoothly', async ({ page }) => {
  const server = await ReplayServer.fromFile(fixture('json-sample.rcg.gz'), {
    host: '127.0.0.1',
    interval: 200,
  });
  try {
    const port = await server.listen();
    await openApp(page, `?connect=1&host=127.0.0.1&port=${port}`);
    await expect(page.locator('#connection-status')).toContainText('Connected');
    await page.keyboard.press('d');
    await wait3d(page);
    await expect
      .poll(() =>
        hook(page, (h) => {
          const r = h.field.renderer.inspect?.();
          const count = (h.playback as unknown as { frameCount: number }).frameCount;
          return count >= 3 && r?.frameIndex === count - 2;
        }),
      )
      .toBe(true);
  } finally {
    await server.close();
  }
});

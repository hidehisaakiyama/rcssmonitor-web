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
    numbers: number;
    fadingNumbers: number;
    facings: number;
    unknownTeams: number;
    rings: number;
    cards: number;
    viewAreas: number;
    camera: { mode: string; position: { x: number; y: number; z: number }; fov: number };
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

/**
 * A JSON log for the player camera's sight: the left 1 at the center looks
 * along +x, 90 degrees wide; the others are near, far, in and out of view.
 */
const SIGHT_PLAYERS: [string, number, number, number][] = [
  ['l', 1, 0, 0], // the one who sees
  ['l', 2, 10, 0], // in view, near: everything
  ['l', 3, 30, 5], // in view, 30 m: the number half known
  ['r', 1, 45, 0], // in view, 45 m: no number, no directions
  ['r', 2, -2, 0], // behind, 2 m: felt
  ['r', 3, -10, 0], // behind, 10 m: not seen
  ['r', 4, 5, 20], // aside: not seen
];
const SIGHT = [
  '[',
  [1, 2]
    .map((time) =>
      JSON.stringify({
        show: {
          time,
          ball: { x: -1, y: 1, vx: 0, vy: 0 }, // behind, near: felt
          players: SIGHT_PLAYERS.map(([side, unum, x, y]) => ({
            side,
            unum,
            type: 0,
            state: 1,
            x,
            y,
            body: 0,
            neck: 0,
            vw: 90,
            stamina: 8000,
            effort: 1,
            recovery: 1,
          })),
        },
      }),
    )
    .join(',\n'), // one record a line, as the server writes
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

test('chooses the player camera styles in the preference dialog', async ({ page }) => {
  await openApp(page, '?view_3d=on&camera_3d=player');
  await wait3d(page);
  await page.setInputFiles('#rcg-file', {
    name: 'sight.rcg',
    mimeType: 'application/json',
    buffer: Buffer.from(SIGHT),
  });
  await expect(page.locator('#load-result')).toContainText('2 frames');
  await hook(page, (h) => {
    h.view.selectPlayer(1);
  });
  const camera = async () => (await scene(page))?.camera;
  // The plain camera: at the eyes, the view width (90) as the field of view.
  await expect.poll(async () => (await camera())?.position).toEqual({ x: 0, y: 1.65, z: 0 });

  await page.keyboard.press('Control+v');
  await page.locator('#config-tab-3d').click();
  await expect(page.locator('#config-player-camera-position-eye')).toBeChecked();
  // The note below a row describes the chosen style; every style has a tooltip.
  const positionHint = page.locator('#config-player-camera-position-hint');
  await expect(positionHint).toContainText('At the eyes, 1.65 m high');
  await expect(page.locator('label:has(#config-player-camera-motion-smooth)')).toHaveAttribute(
    'title',
    /at most ω·Δt/,
  );
  await expect(page.locator('label[for="config-player-camera-max-turn"]')).toHaveAttribute(
    'title',
    /fastest/,
  );
  await page.locator('#config-player-camera-position-shoulder').check();
  await expect(positionHint).toContainText('6 m behind the player');
  await expect.poll(async () => (await camera())?.position.y).toBe(3);
  const p = await camera();
  expect(p?.position.x).toBeCloseTo(-6); // behind
  expect(p?.position.z).toBeCloseTo(0);
  // Over the shoulder, the player is drawn too (and the 15 not connected, in black).
  expect((await scene(page))?.players).toBe(22);

  await page.locator('#config-player-camera-fov-fixed').check();
  await page.locator('#config-player-camera-fixed-fov').fill('60');
  await page.locator('#config-player-camera-fixed-fov').press('Enter');
  // Horizontal 60 degrees: the vertical one depends on the shape of the canvas.
  const aspect = await hook(page, (h) => {
    const c = h.field.renderer.canvas;
    return c.clientWidth / c.clientHeight;
  });
  const vertical = 2 * Math.atan(Math.tan(Math.PI / 6) / aspect) * (180 / Math.PI);
  await expect.poll(async () => (await camera())?.fov).toBeCloseTo(vertical, 3);

  // Kept, and the default is the plain camera again.
  await page.reload();
  await wait3d(page);
  await page.keyboard.press('Control+v');
  await page.locator('#config-tab-3d').click();
  await expect(page.locator('#config-player-camera-position-shoulder')).toBeChecked();
  await expect(page.locator('#config-player-camera-fixed-fov')).toHaveValue('60');
  await expect(positionHint).toContainText('6 m behind the player');
  await expect(page.locator('#config-player-camera-default')).toHaveAttribute(
    'title',
    /Eyes, Head \(Body \+ Neck\), Instant, View Width, Everything, τ 0\.5 s, ω 90°\/s, Fixed 90°/,
  );
  await page.locator('#config-player-camera-default').click();
  await expect(page.locator('#config-player-camera-position-eye')).toBeChecked();
  await expect(page.locator('#config-player-camera-fov-view')).toBeChecked();
  await expect(positionHint).toContainText('At the eyes');
});

test("draws only what the player camera's player perceives", async ({ page }) => {
  await openApp(page, '?view_3d=on&camera_3d=player&player_camera_sight=server');
  await wait3d(page);
  await page.setInputFiles('#rcg-file', {
    name: 'sight.rcg',
    mimeType: 'application/json',
    buffer: Buffer.from(SIGHT),
  });
  await expect(page.locator('#load-result')).toContainText('2 frames');
  await hook(page, (h) => {
    h.view.selectPlayer(1);
  });
  const seen = async () => {
    const s = await scene(page);
    return (
      s && {
        players: s.players,
        numbers: s.numbers,
        fadingNumbers: s.fadingNumbers,
        facings: s.facings,
        unknownTeams: s.unknownTeams,
        ball: s.ball.visible,
      }
    );
  };
  // Server rules, at the eyes (the player itself is not drawn): the left 2,
  // 3, the right 1 in view, the right 2 felt in gray; the ball felt.
  await expect.poll(seen).toEqual({
    players: 4,
    numbers: 2,
    fadingNumbers: 1,
    facings: 2,
    unknownTeams: 1,
    ball: true,
  });

  await page.keyboard.press('Control+v');
  await page.locator('#config-tab-3d').click();
  await expect(page.locator('#config-player-camera-sight-server')).toBeChecked();
  await page.locator('#config-player-camera-sight-view').check();
  await expect.poll(seen).toEqual({
    players: 3,
    numbers: 3,
    fadingNumbers: 0,
    facings: 3,
    unknownTeams: 0,
    ball: false,
  });

  // Everything, also the 15 not connected (in black); the player itself not.
  await page.locator('#config-player-camera-sight-all').check();
  await expect.poll(seen).toEqual({
    players: 21,
    numbers: 21,
    fadingNumbers: 0,
    facings: 21,
    unknownTeams: 0,
    ball: true,
  });

  // Only for the player camera.
  await page.locator('#config-player-camera-sight-view').check();
  await page.locator('#camera-select').selectOption('broadcast');
  await expect.poll(async () => (await seen())?.players).toBe(22);
});

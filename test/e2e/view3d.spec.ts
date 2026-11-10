import { expect, test, type Page } from '@playwright/test';
import { Side } from '../../src/core/constants';
import type { Vec2 } from '../../src/core/geometry';
import { dispFoul } from '../../src/io/live/commands';
import type { FieldTarget } from '../../src/ui/field-view';
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
    stadium: {
      sides: { color: string; name: string; logo: boolean }[];
      boards: boolean;
      banners: boolean;
      nets: string[];
    };
    overlays: {
      focusPoints: number;
      catchAreas: number;
      tackleAreas: number;
      kickAccelAreas: number;
      pointtos: number;
      offsideLines: number;
      ballPath: number;
      labels: string[];
    };
    labels: string[];
    numberPositions: ({ x: number; y: number; z: number } | null)[];
    numberHeight: number;
    staminaBars: {
      side: number;
      unum: number;
      stamina: number | null;
      capacity: number | null;
      at: { x: number; y: number; z: number };
    }[];
    frameIndex: number;
    drawCalls: number;
  };
  fieldToScreen?(x: number, y: number): { x: number; y: number } | null;
  guide?(): { x: number; y: number; direction: number; fov: number } | null;
  labels?(): { x: number; y: number; text: string; color: string }[];
}

interface Hook {
  view: ViewState;
  field: {
    renderer: Renderer;
    frameIndex: number;
    hud: {
      guides: {
        compass: { left: number; right: number; ball: number | null } | null;
        minimap: { x: number; y: number; width: number; height: number } | null;
      };
    };
  };
  playback: { index: number };
  renderNow(): void;
  showFrame(index: number): void;
}

const hook = <T>(page: Page, f: (h: Hook) => T) =>
  page.evaluate(`(${f.toString()})(window.rcssmonitorWeb)`) as Promise<T>;

const kind = (page: Page) => hook(page, (h) => h.field.renderer.kind);
const scene = (page: Page) => hook(page, (h) => h.field.renderer.inspect?.());

/** The app's message when the 3D view cannot open (app.ts set3d). */
const NOT_AVAILABLE = 'The 3D view is not available';

/**
 * Waits until the 3D view has drawn. If it does not open, the error says
 * why, as the app tells on the status bar (e.g. no WebGL).
 *
 * Headless Firefox on the CI's software rendering now and then fails to
 * create a WebGL context, and the app stays 2D. Only then, it tries once
 * more with the 3D button (noted in the report); a second failure fails.
 */
async function wait3d(page: Page): Promise<void> {
  const status = page.locator('#status-message');
  const open = async (): Promise<string | null> => {
    try {
      await expect
        .poll(
          async () =>
            (await kind(page)) === '3d' || (await status.textContent())?.includes(NOT_AVAILABLE),
        )
        .toBe(true);
    } catch {
      return (await status.textContent()) ?? '(no message)';
    }
    return (await kind(page)) === '3d' ? null : ((await status.textContent()) ?? '');
  };
  let failed = await open();
  if (failed?.includes('Error creating WebGL context')) {
    test.info().annotations.push({ type: 'warning', description: `3D view, first try: ${failed}` });
    await page.locator('#view-3d-button').click();
    failed = await open();
  }
  if (failed !== null) {
    throw new Error(`the 3D view did not open: ${failed}`);
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

  // The player camera: a hint without a selected player, then over its
  // shoulder (by default): 6 m behind it, 3 m high.
  await page.locator('#camera-select').selectOption('player');
  await expect(page.locator('#status-message')).toContainText('Select a player');
  await page.keyboard.press('5');
  const at = await hook(page, (h) => {
    const p = (
      h.field as unknown as {
        gameStore: { frame(i: number): { players: { x: number; y: number }[] } };
      }
    ).gameStore.frame(h.field.frameIndex).players[4];
    return { x: p?.x, y: p?.y };
  });
  await expect
    .poll(async () => {
      const c = (await camera())?.position;
      const behind = c && Math.hypot(c.x - (at.x ?? 0), c.z - (at.y ?? 0));
      return c && { y: c.y, behind: Math.round((behind ?? 0) * 1000) / 1000 };
    })
    .toEqual({ y: 3, behind: 6 });

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
    // Often: until the next draw after a frame arrives (from software
    // rendering, a good part of the time), the last one drawn is older.
    await expect
      .poll(
        () =>
          hook(page, (h) => {
            const r = h.field.renderer.inspect?.();
            const count = (h.playback as unknown as { frameCount: number }).frameCount;
            return count >= 3 && r?.frameIndex === count - 2;
          }),
        { intervals: [50] },
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
  // The vertical field of view for a horizontal one depends on the shape of the canvas.
  const aspect = await hook(page, (h) => {
    const c = h.field.renderer.canvas;
    return c.clientWidth / c.clientHeight;
  });
  const vertical = (h: number) =>
    2 * Math.atan(Math.tan((h / 2) * (Math.PI / 180)) / aspect) * (180 / Math.PI);

  // The default: over the shoulder, 120 degrees wide, by the server rules.
  await expect.poll(async () => (await camera())?.position.y).toBe(3);
  const p = await camera();
  expect(p?.position.x).toBeCloseTo(-6); // behind
  expect(p?.position.z).toBeCloseTo(0);
  expect(p?.fov).toBeCloseTo(vertical(120), 3);
  // The player itself and the 4 it perceives (not the 15 not connected).
  expect((await scene(page))?.players).toBe(5);

  await page.keyboard.press('Control+v');
  await page.locator('#config-tab-player-camera').click();
  for (const id of ['position-shoulder', 'direction-head', 'motion-smooth', 'fov-fixed']) {
    await expect(page.locator(`#config-player-camera-${id}`)).toBeChecked();
  }
  await expect(page.locator('#config-player-camera-sight-server')).toBeChecked();
  await expect(page.locator('#config-player-camera-fixed-fov')).toHaveValue('120');
  // The note below a row describes the chosen style; every style has a tooltip.
  const positionHint = page.locator('#config-player-camera-position-hint');
  await expect(positionHint).toContainText('6 m behind the player');
  await expect(page.locator('label:has(#config-player-camera-motion-smooth)')).toHaveAttribute(
    'title',
    /at most ω·Δt/,
  );
  await expect(page.locator('label[for="config-player-camera-max-turn"]')).toHaveAttribute(
    'title',
    /fastest/,
  );
  await expect(page.locator('#config-player-camera-default')).toHaveAttribute(
    'title',
    /Over the Shoulder, Head, Smooth, Fixed, Server Rules, τ 0\.5 s, ω 90°\/s, Fixed 120°/,
  );

  // The first, plain camera can still be chosen: at the eyes, as wide as the view (90).
  await page.locator('#config-player-camera-position-eye').check();
  await expect(positionHint).toContainText('At the eyes, 1.65 m high');
  await expect.poll(async () => (await camera())?.position).toEqual({ x: 0, y: 1.65, z: 0 });
  await page.locator('#config-player-camera-fov-view').check();
  await expect.poll(async () => (await camera())?.fov).toBeCloseTo(vertical(90), 3);
  // The numbers the chosen styles do not use are dim.
  await expect(page.locator('#config-player-camera-fixed-fov')).toBeDisabled();
  await page.locator('#config-player-camera-motion-instant').check();
  await expect(page.locator('#config-player-camera-max-turn')).toBeDisabled();
  await expect(page.locator('#config-player-camera-time-constant')).toBeDisabled();
  await expect(page.locator('label[for="config-player-camera-max-turn"]')).toHaveClass(/disabled/);
  await page.locator('#config-player-camera-motion-smooth').check();
  await expect(page.locator('#config-player-camera-max-turn')).toBeEnabled();
  // Or fixed at another width. Out of the range, it shows the error color
  // while typed, then goes to the nearest end; what is not a number goes back.
  await page.locator('#config-player-camera-fov-fixed').check();
  const fixed = page.locator('#config-player-camera-fixed-fov');
  await expect(fixed).toHaveAttribute('title', /Range: 20–120°/);
  await expect(page.locator('#config-player-camera-max-turn')).toHaveAttribute(
    'title',
    /Range: 1–3600°\/s/,
  );
  await fixed.fill('200');
  await expect(fixed).toHaveClass(/invalid/);
  await fixed.press('Enter');
  await expect(fixed).toHaveValue('120');
  await expect(fixed).not.toHaveClass(/invalid/);
  await expect.poll(async () => (await camera())?.fov).toBeCloseTo(vertical(120), 3);
  await fixed.fill('5');
  await fixed.press('Enter');
  await expect(fixed).toHaveValue('20');
  await fixed.fill('');
  await fixed.press('Enter');
  await expect(fixed).toHaveValue('20');
  await page.locator('#config-player-camera-fixed-fov').fill('60');
  await page.locator('#config-player-camera-fixed-fov').press('Enter');
  await expect.poll(async () => (await camera())?.fov).toBeCloseTo(vertical(60), 3);

  // Kept, and Default sets the defaults again.
  await page.reload();
  await wait3d(page);
  await page.keyboard.press('Control+v');
  await page.locator('#config-tab-player-camera').click();
  await expect(page.locator('#config-player-camera-position-eye')).toBeChecked();
  await expect(page.locator('#config-player-camera-fixed-fov')).toHaveValue('60');
  await expect(positionHint).toContainText('At the eyes');
  await page.locator('#config-player-camera-default').click();
  await expect(page.locator('#config-player-camera-position-shoulder')).toBeChecked();
  await expect(page.locator('#config-player-camera-fov-fixed')).toBeChecked();
  await expect(page.locator('#config-player-camera-fixed-fov')).toHaveValue('120');
  await expect(positionHint).toContainText('6 m behind the player');
});

test("draws only what the player camera's player perceives", async ({ page }) => {
  await openApp(page, '?view_3d=on&camera_3d=player&player_camera_position=eye');
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
  // Server rules (the default), at the eyes (the player itself is not drawn): the left 2,
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
  await page.locator('#config-tab-player-camera').click();
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

test('paints the ends in the team colors and shows the compass and the minimap', async ({
  page,
}) => {
  await openApp(page, '?view_3d=on&camera_3d=player&compass_3d=player&minimap_3d=all');
  await wait3d(page);
  await loadLog(page, 'json-sample.rcg.gz');
  // The nets, the boards and the banners: the left team keeps the left goal.
  const stadium = async () => (await scene(page))?.stadium;
  await expect.poll(stadium).toEqual({
    sides: [
      { color: '#ffd700', name: 'HELIOS2023', logo: true },
      { color: '#00bfff', name: 'CYRUS', logo: false },
    ],
    boards: true,
    banners: true,
    nets: ['#ffd700', '#00bfff'],
  });
  // They follow the colors and the Team Graphic option.
  await hook(page, (h) => {
    h.view.colors.leftTeam = '#ff0000';
    h.view.set('showTeamGraphic', false);
  });
  await expect.poll(stadium).toEqual({
    sides: [
      { color: '#ff0000', name: 'HELIOS2023', logo: false },
      { color: '#00bfff', name: 'CYRUS', logo: false },
    ],
    boards: true,
    banners: true,
    nets: ['#ff0000', '#00bfff'],
  });

  const guides = () =>
    hook(page, (h) => {
      h.renderNow();
      return h.field.hud.guides;
    });
  // The player camera without a player is the broadcast one, from the near
  // touch line (+y): the left goal on the left of the compass, the right one
  // on the right, the ball between them.
  const g = await guides();
  expect(g.compass).not.toBeNull();
  expect(g.minimap).not.toBeNull();
  const { left, right, ball } = g.compass ?? { left: 0, right: 0, ball: null };
  expect(left).toBeLessThan(ball ?? -1);
  expect(ball).toBeLessThan(right);
  const direction = await hook(page, (h) => h.field.renderer.guide?.()?.direction);
  expect(direction).toBeCloseTo(-90); // up the 2D screen

  // The compass only with the player camera, the minimap with all but the top.
  await page.locator('#camera-select').selectOption('broadcast');
  await expect.poll(async () => (await guides()).compass).toBeNull();
  expect((await guides()).minimap).not.toBeNull();
  await page.locator('#camera-select').selectOption('top');
  await expect.poll(async () => (await guides()).minimap).toBeNull();

  // Set in the 3D tab, kept, and off by default.
  await page.locator('#camera-select').selectOption('free');
  await page.keyboard.press('Control+v');
  await page.locator('#config-tab-3d').click();
  await expect(page.locator('#config-compass-3d-player')).toBeChecked();
  await expect(page.locator('label:has(#config-minimap-3d-all)')).toHaveAttribute(
    'title',
    /every camera but Top/,
  );
  await page.locator('#config-compass-3d-all').check();
  await expect.poll(async () => (await guides()).compass).not.toBeNull();
  // The boards and the banners can be hidden; the nets keep the colors.
  await expect(page.locator('#config-boards-3d')).toBeChecked();
  await page.locator('#config-boards-3d').uncheck();
  await page.locator('#config-banners-3d').uncheck();
  await expect
    .poll(async () => {
      const s = await stadium();
      return s && { boards: s.boards, banners: s.banners, nets: s.nets };
    })
    .toEqual({ boards: false, banners: false, nets: ['#ff0000', '#00bfff'] });
  await page.locator('#config-3d-default').click();
  await expect(page.locator('#config-compass-3d-off')).toBeChecked();
  await expect(page.locator('#config-minimap-3d-off')).toBeChecked();
  await expect(page.locator('#config-banners-3d')).toBeChecked();
  await expect.poll(async () => (await stadium())?.boards).toBe(true);
  await expect.poll(async () => await guides()).toEqual({ compass: null, minimap: null });
  // Not over the 2D view.
  await page.locator('#config-compass-3d-all').check();
  await page.locator('#view-3d-button').click();
  await expect.poll(() => kind(page)).toBe('2d');
  await expect.poll(async () => await guides()).toEqual({ compass: null, minimap: null });
});

test('stays 2D when WebGL fails, and can try again', async ({ page }) => {
  // The first WebGL context cannot be created, as now and then on the CI.
  await page.addInitScript(() => {
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext: (this: HTMLCanvasElement, type: string, ...rest: unknown[]) => unknown;
    };
    const get = proto.getContext;
    let failed = false;
    proto.getContext = function (type, ...rest) {
      if (!failed && type.startsWith('webgl')) {
        failed = true;
        return null;
      }
      return get.call(this, type, ...rest);
    };
  });
  await openApp(page);
  await page.keyboard.press('d');
  await expect(page.locator('#status-message')).toContainText(
    `${NOT_AVAILABLE}: THREE.WebGLRenderer: Error creating WebGL context`,
  );
  expect(await kind(page)).toBe('2d');
  await expect(page.locator('#view-3d-button')).toHaveAttribute('aria-pressed', 'false');
  // wait3d tries again with the 3D button, which opens it this time.
  await wait3d(page);
  await expect(page.locator('#view-3d-button')).toHaveAttribute('aria-pressed', 'true');
  expect(test.info().annotations.some((a) => a.description?.includes('first try'))).toBe(true);
});

interface AimHook {
  field: {
    element: HTMLElement;
    renderer: { fieldToScreen(x: number, y: number, height?: number): Vec2 | null };
    targetAt(clientX: number, clientY: number): FieldTarget;
  };
}

/**
 * The window point of a field point at a height, in 3D, in whole pixels: a
 * click arrives in whole pixels, and from afar one pixel is 0.1-0.2 m.
 */
const windowOf = (page: Page, x: number, y: number, height = 0) =>
  page.evaluate(
    ({ x, y, height }) => {
      const field = (window.rcssmonitorWeb as AimHook).field;
      const r = field.element.getBoundingClientRect();
      const s = field.renderer.fieldToScreen(x, y, height);
      return s && { x: Math.round(r.left + s.x), y: Math.round(r.top + s.y) };
    },
    { x, y, height },
  );

/** Waits until the 3D camera stops (the broadcast camera glides after the ball). */
const cameraStill = (page: Page) =>
  expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window.rcssmonitorWeb as { field: { renderer: { animating?(): boolean } } }
          ).field.renderer.animating?.() ?? false,
      ),
    )
    .toBe(false);

/** What a right click at a field point at a height aims at. */
async function aimAt(page: Page, x: number, y: number, height = 0): Promise<FieldTarget | null> {
  const w = await windowOf(page, x, y, height);
  return (
    w && page.evaluate(({ x, y }) => (window.rcssmonitorWeb as AimHook).field.targetAt(x, y), w)
  );
}

test('aims a right click at the player under it, or at the ground near the pitch', async ({
  page,
}) => {
  await openApp(
    page,
    '?view_3d=on&camera_3d=player&player_camera_position=eye&player_camera_sight=all',
  );
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
  // At the eyes of the left 1 at the center, looking along +x.
  await expect
    .poll(async () => (await scene(page))?.camera.position)
    .toEqual({
      x: 0,
      y: 1.65,
      z: 0,
    });
  const l2 = { point: { x: 10, y: 0 }, player: { side: Side.Left, unum: 2 } };
  // The head of the left 2, 10 m ahead, at the height of the eyes: the ray
  // never meets the ground. The body too.
  expect(await aimAt(page, 10, 0, 1.65)).toEqual(l2);
  expect(await aimAt(page, 10, 0, 0.7)).toEqual(l2);
  expect((await aimAt(page, 30, 5, 0.7))?.player).toEqual({ side: Side.Left, unum: 3 });
  // The ground where no player is.
  const ground = await aimAt(page, 8, -3);
  expect(ground?.player).toBeNull();
  expect(ground?.point?.x).toBeCloseTo(8, 0);
  expect(Math.abs((ground?.point?.y ?? 0) + 3)).toBeLessThan(0.3);
  // Nothing: the ground far beyond the pitch, or the sky.
  expect(await aimAt(page, 80, -15)).toEqual({ point: null, player: null });
  expect(await aimAt(page, 20, 0, 30)).toEqual({ point: null, player: null });
});

test('sends the referee commands aimed in 3D', async ({ page }) => {
  const server = await ReplayServer.fromFile(fixture('json-sample.rcg.gz'), {
    host: '127.0.0.1',
    interval: 20,
    coach: true,
  });
  try {
    const port = await server.listen();
    await openApp(page, `?connect=1&host=127.0.0.1&port=${port}&view_3d=on&camera_3d=broadcast`);
    await expect(page.locator('#connection-status')).toContainText('Connected');
    await wait3d(page);
    await page.keyboard.press('ArrowLeft'); // stay on one frame
    await cameraStill(page);
    const commands = () => server.commands.map((c) => c.text);
    const box = await page.locator('.field-view').boundingBox();
    if (!box) {
      throw new Error('no field view');
    }

    // Far beyond the pitch: no point to put the ball at; Change Playmode
    // starts from the ball.
    await page.mouse.click(box.x + box.width / 2, box.y + 12, { button: 'right' });
    await expect(page.locator('#menu-drop-ball')).toBeDisabled();
    await expect(page.locator('#menu-drop-ball')).toHaveAttribute('title', /pitch or its margin/);
    await expect(page.locator('#menu-free-kick-left')).toBeDisabled();
    await expect(page.locator('#menu-change-playmode')).toBeEnabled();
    await expect(page.locator('#menu-yellow-card')).toBeEnabled();
    await page.keyboard.press('Escape');

    // On the head of the nearest player to the camera of those whose head
    // is on the canvas (nothing in front of it): the card dialog chooses it.
    // Which frame it stays on depends on how many had arrived, and the
    // nearest of all may be below the canvas.
    const nearest = await page.evaluate(() => {
      const h = window.rcssmonitorWeb as {
        field: {
          element: HTMLElement;
          frameIndex: number;
          gameStore: {
            frame(i: number): {
              players: { side: number; unum: number; x: number; y: number; state: number }[];
            };
          } | null;
          renderer: {
            fieldToScreen(x: number, y: number, height: number): { x: number; y: number } | null;
            inspect(): { camera: { position: { x: number; y: number; z: number } } };
          };
        };
      };
      const r = h.field.element.getBoundingClientRect();
      const c = h.field.renderer.inspect().camera.position;
      const players = h.field.gameStore?.frame(h.field.frameIndex).players ?? [];
      const inView = players
        .filter((p) => p.state !== 0)
        .map((p) => ({ p, s: h.field.renderer.fieldToScreen(p.x, p.y, 1.65) }))
        .filter(
          ({ s }) =>
            s !== null && s.x > 20 && s.y > 20 && s.x < r.width - 20 && s.y < r.height - 20,
        );
      inView.sort(
        (a, b) => Math.hypot(a.p.x - c.x, a.p.y - c.z) - Math.hypot(b.p.x - c.x, b.p.y - c.z),
      );
      const p = inView[0]?.p;
      return p && { side: p.side, unum: p.unum, x: p.x, y: p.y };
    });
    if (!nearest) {
      throw new Error('no player in view');
    }
    const head = await windowOf(page, nearest.x, nearest.y, 1.65);
    if (!head) {
      throw new Error('the player is not in view');
    }
    await page.mouse.click(head.x, head.y, { button: 'right' });
    await page.locator('#menu-yellow-card').click();
    await expect(page.locator('#card-player')).toHaveValue(`${nearest.side} ${nearest.unum}`);
    await page.locator('#card-dialog-ok').click();
    await expect
      .poll(() => commands().at(-1))
      .toBe(`(dispcard ${nearest.side} ${nearest.unum} yellow)`);

    // On the ground: the ball there.
    await cameraStill(page);
    const at = await aimAt(page, 10, -5);
    const w = await windowOf(page, 10, -5);
    if (!at?.point || !w) {
      throw new Error('no point on the ground');
    }
    await page.mouse.click(w.x, w.y, { button: 'right' });
    await page.locator('#menu-drop-ball').click();
    await expect.poll(() => commands().at(-1)).toBe(dispFoul(at.point.x, at.point.y, Side.Neutral));
  } finally {
    await server.close();
  }
});

test('draws the overlays of the 2D view in 3D', async ({ page }) => {
  const options = [
    'show_player_type=on',
    'show_focus_point=on',
    'show_catch_area=on',
    'show_tackle_area=on',
    'show_kick_accel_area=on',
    'show_pointto=on',
    'show_offside_line=on',
    'ball_vel_cycle=10',
  ].join('&');
  await openApp(page, `?view_3d=on&camera_3d=broadcast&${options}`);
  await wait3d(page);
  await loadLog(page, 'json-sample.rcg.gz');
  // In cycle 32 the left 7 has the ball at its feet.
  await hook(page, (h) => {
    h.showFrame(31);
    h.view.selectPlayer(7);
  });
  await expect(page.locator('#frame-label')).toHaveText('32 (32 / 267)');
  await expect
    .poll(async () => (await scene(page))?.overlays)
    .toEqual({
      focusPoints: 0, // it does not attentionto
      catchAreas: 2,
      tackleAreas: 1,
      kickAccelAreas: 1,
      pointtos: 12,
      offsideLines: 2,
      ballPath: 10,
      labels: ['T=0.995,F=1', 'MaxAccel=2.209'],
    });
  // The number labels with the player types; the texts for the HUD, on the canvas.
  expect((await scene(page))?.labels[6]).toBe('7,t9');
  const texts = await hook(page, (h) => h.field.renderer.labels?.().map((l) => l.text));
  expect(texts).toEqual(['T=0.995,F=1', 'MaxAccel=2.209']);

  // The player camera of the left 7, by the view cone: the overlays of the
  // players it sees, and its own.
  await hook(page, (h) => {
    h.view.selectPlayer(7);
  });
  await page.locator('#camera-select').selectOption('player');
  await page.keyboard.press('Control+v');
  await page.locator('#config-tab-player-camera').click();
  await page.locator('#config-player-camera-sight-view').check();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await scene(page))?.overlays.kickAccelAreas).toBe(1);
  const seen = await scene(page);
  expect(seen?.overlays.pointtos).toBeLessThan(12);
  expect(seen?.overlays.offsideLines).toBe(2);

  // All off as in 2D: the numbers only.
  await page.locator('#camera-select').selectOption('broadcast');
  await hook(page, (h) => {
    for (const name of [
      'showPlayerType',
      'showCatchArea',
      'showTackleArea',
      'showKickAccelArea',
      'showPointto',
      'showOffsideLine',
    ] as const) {
      h.view.set(name, false);
    }
    h.view.set('ballVelCycle', 0);
  });
  await expect
    .poll(async () => (await scene(page))?.overlays)
    .toEqual({
      focusPoints: 0,
      catchAreas: 0,
      tackleAreas: 0,
      kickAccelAreas: 0,
      pointtos: 0,
      offsideLines: 0,
      ballPath: 0,
      labels: [],
    });
  expect((await scene(page))?.labels[6]).toBe('7');
});

test('draws the stamina and the capacity as bars in 3D', async ({ page }) => {
  await openApp(page, '?view_3d=on&camera_3d=broadcast&show_stamina=on&show_stamina_capacity=on');
  await wait3d(page);
  await loadLog(page, 'json-sample.rcg.gz');
  await hook(page, (h) => {
    h.showFrame(31);
    h.view.selectPlayer(7);
  });
  await expect(page.locator('#frame-label')).toHaveText('32 (32 / 267)');
  const bars = async () => (await scene(page))?.staminaBars ?? [];
  // Every player, with both bars, as long as what is left.
  const left7 = await page.evaluate(() => {
    const field = (
      window.rcssmonitorWeb as {
        field: {
          frameIndex: number;
          gameStore: {
            serverParam: { stamina_max: number; stamina_capacity: number };
            frame(i: number): { players: { stamina: number; capacity?: number }[] };
          };
        };
      }
    ).field;
    const p = field.gameStore.frame(field.frameIndex).players[6];
    const sp = field.gameStore.serverParam;
    return {
      stamina: Math.min(1, (p?.stamina ?? 0) / sp.stamina_max),
      capacity: (p?.capacity ?? 0) / sp.stamina_capacity,
    };
  });
  const seven = async () => (await bars()).find((b) => b.side === Side.Left && b.unum === 7);
  // Drawn for cycle 32 (not the frame before, at full stamina).
  await expect.poll(async () => (await seven())?.stamina ?? 0).toBeCloseTo(left7.stamina, 5);
  expect((await seven())?.capacity).toBeCloseTo(left7.capacity, 5);
  expect(await bars()).toHaveLength(22);

  // The server does not tell a player the others' stamina: the player
  // camera (by the server rules) shows only its own, over its shoulder.
  await page.locator('#camera-select').selectOption('player');
  await expect
    .poll(async () => (await bars()).map((b) => [b.side, b.unum]))
    .toEqual([[Side.Left, 7]]);

  // Under the number as the camera sees it, from the side and from above
  // (where a height would put them on the number).
  for (const camera of ['broadcast', 'top']) {
    await page.locator('#camera-select').selectOption(camera);
    await cameraStill(page);
    const measure = () =>
      page.evaluate(() => {
        const field = (
          window.rcssmonitorWeb as {
            field: {
              frameIndex: number;
              gameStore: { frame(i: number): { players: { x: number; y: number }[] } };
              renderer: {
                fieldToScreen(x: number, y: number, h: number): { x: number; y: number } | null;
                inspect(): {
                  numberPositions: ({ x: number; y: number; z: number } | null)[];
                  numberHeight: number;
                  staminaBars: {
                    side: number;
                    unum: number;
                    at: { x: number; y: number; z: number };
                  }[];
                };
              };
            };
          }
        ).field;
        const r = field.renderer;
        const state = r.inspect();
        const b = state.staminaBars.find((q) => q.side === 1 && q.unum === 7);
        const n = state.numberPositions[6];
        const p = field.gameStore.frame(field.frameIndex).players[6];
        if (!b || !n || !p) {
          return null;
        }
        const number = r.fieldToScreen(n.x, n.z, n.y);
        const bar = r.fieldToScreen(b.at.x, b.at.z, b.at.y);
        return (
          number &&
          bar && {
            pixels: bar.y - number.y,
            // From above: the bars below the number on the screen (+Z),
            // the number right of the kickable area (1.085 m) and its foot
            // on the player's center line (the text is 40 / 64 of the label).
            below: b.at.z - n.z,
            right: n.x - p.x,
            up: p.y - n.z,
            textHalf: (state.numberHeight * 20) / 64,
          }
        );
      });
    // As drawn with this camera (the next draw after the switch).
    if (camera === 'top') {
      // As 2D: to the right of the kickable area, the bars under the text.
      await expect.poll(async () => (await measure())?.right ?? 0).toBeGreaterThan(1.085);
      const m = await measure();
      expect(m?.up).toBeCloseTo(m?.textHalf ?? 0, 5);
      expect(m?.below).toBeGreaterThan(m?.textHalf ?? 1);
      expect(m?.pixels).toBeGreaterThan(0);
    } else {
      // Above the head, the bars under the number.
      await expect.poll(async () => (await measure())?.pixels ?? 0).toBeGreaterThan(3);
      expect((await measure())?.right).toBeCloseTo(0, 5);
    }
  }

  // S turns, as in rcssmonitor: from both, neither, the stamina, the capacity, both.
  await page.locator('#camera-select').selectOption('broadcast');
  const shown = async () => {
    const b = await bars();
    return [b.some((q) => q.stamina !== null), b.some((q) => q.capacity !== null)];
  };
  for (const next of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ]) {
    await page.keyboard.press('s');
    await expect.poll(shown).toEqual(next);
  }
  // The Show options, as the texts in 2D.
  await hook(page, (h) => {
    h.view.set('showStaminaCapacity', false);
  });
  await expect.poll(async () => (await bars()).every((b) => b.capacity === null)).toBe(true);
  await hook(page, (h) => {
    h.view.set('showStamina', false);
  });
  await expect.poll(bars).toEqual([]);
});

test('writes the numbers from the top camera as large as the 2D player font', async ({ page }) => {
  await openApp(page, '?view_3d=on&camera_3d=top');
  await wait3d(page);
  await loadLog(page, 'json-sample.rcg.gz');
  /** The height of the numbers' text on the screen (40 of the label's 64 px), in pixels. */
  const textPixels = () =>
    page.evaluate(() => {
      const r = (
        window.rcssmonitorWeb as {
          field: {
            renderer: {
              fieldToScreen(x: number, y: number): { x: number; y: number } | null;
              inspect(): { numberHeight: number };
            };
          };
        }
      ).field.renderer;
      const a = r.fieldToScreen(0, 0);
      const b = r.fieldToScreen(10, 0);
      const perMeter = a && b ? (b.x - a.x) / 10 : 0;
      return (r.inspect().numberHeight * 40 * perMeter) / 64;
    });
  await expect.poll(textPixels).toBeCloseTo(12, 0); // 9 pt
  // Whatever the size of the window.
  await page.setViewportSize({ width: 900, height: 600 });
  await expect.poll(textPixels).toBeCloseTo(12, 0);
  // As the Font tab's player font.
  await hook(page, (h) => {
    h.view.fonts.player.size = 20;
    h.view.changed();
  });
  await expect.poll(textPixels).toBeCloseTo(20, 0);
  // From the side, the labels keep their size in meters.
  await page.locator('#camera-select').selectOption('broadcast');
  await expect.poll(async () => (await scene(page))?.numberHeight).toBe(1.3);
});

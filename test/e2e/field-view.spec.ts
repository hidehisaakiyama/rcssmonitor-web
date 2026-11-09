import { expect, test, type Page } from '@playwright/test';
import {
  loadLog,
  openApp,
  requireBuild,
  setFieldSize,
  show,
  useTestFonts,
  type Hook,
  type Scene,
} from './helpers';

// The 2D field view: screenshot regression tests and mouse / keyboard
// operations. The canvas size is the one of the rcssmonitor captures in
// tools/parity (1000 x 720 window minus its 43 pixel tool bar).
requireBuild();

const WIDTH = 1000;
const HEIGHT = 677;

async function prepare(page: Page, log: string): Promise<void> {
  await openApp(page);
  await setFieldSize(page, WIDTH, HEIGHT);
  await useTestFonts(page);
  await loadLog(page, log);
}

const screenshots: [string, string, Scene][] = [
  ['json-kickoff', 'json-sample.rcg.gz', { frame: 0 }],
  [
    'json-options',
    'json-sample.rcg.gz',
    {
      frame: 150,
      select: 5,
      options: {
        showViewArea: true,
        showStamina: true,
        showTackleArea: true,
        showCatchArea: true,
        showOffsideLine: true,
        showFlag: true,
        showKickAccelArea: true,
        showPointto: true,
        showPlayerType: true,
      },
    },
  ],
  ['json-card', 'json-sample.rcg.gz', { frame: 251 }],
  [
    'json-grid',
    'json-sample.rcg.gz',
    {
      frame: 100,
      options: { gridStep: 10, showGridCoord: true, showKeepawayArea: true, ballVelCycle: 20 },
    },
  ],
  ['text-goal', 'text-v5-sample.rcg.gz', { frame: 248, options: { showViewArea: true } }],
  ['pk-score-board', 'json-pk.rcg.gz', { frame: 30 }],
];

for (const [name, log, scene] of screenshots) {
  test(`draws ${name}`, async ({ page }) => {
    await prepare(page, log);
    await show(page, scene);
    await expect(page.locator('.field-view')).toHaveScreenshot(`${name}.png`, {
      maxDiffPixelRatio: 0.005,
    });
  });
}

const viewState = (page: Page) =>
  page.evaluate(() => {
    const v = (window.rcssmonitorWeb as Hook).view;
    return {
      scale: v.fieldScale,
      zoomed: v.zoomed,
      focusType: v.focusType,
      focus: v.focusPoint,
      selected: v.selected,
    };
  });

test('zooms with Z / X and fits with I', async ({ page }) => {
  await prepare(page, 'json-sample.rcg.gz');
  await show(page, {});
  const before = await viewState(page);
  expect(before.scale).toBeGreaterThan(7);
  await page.keyboard.press('z');
  expect((await viewState(page)).scale).toBeCloseTo(before.scale * 1.5);
  await page.keyboard.press('x');
  await page.keyboard.press('x');
  expect((await viewState(page)).scale).toBeCloseTo(before.scale / 1.5);
  await page.keyboard.press('i');
  await page.evaluate(() => (window.rcssmonitorWeb as Hook).renderNow());
  expect(await viewState(page)).toMatchObject({ scale: before.scale, zoomed: false });
});

test('moves the focus by double click and by dragging', async ({ page }) => {
  await prepare(page, 'json-sample.rcg.gz');
  await show(page, {});
  const field = page.locator('.field-view');
  const box = await field.boundingBox();
  if (!box) {
    throw new Error('no field view');
  }
  const { scale } = await viewState(page);

  // Double click 80 pixels right of the center: that point becomes the center.
  await page.mouse.dblclick(box.x + 500 + 80, box.y + 345);
  let s = await viewState(page);
  expect(s.focusType).toBe('point');
  expect(s.focus.x).toBeCloseTo(80 / scale, 1);
  const focusY = s.focus.y;
  await page.evaluate(() => (window.rcssmonitorWeb as Hook).renderNow());

  // Dragging the field 40 pixels to the right moves the focus about 40
  // pixels left. As in rcssmonitor, the movement up to the drag threshold
  // (more than 2 pixels) is not applied.
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 340, box.y + 300, { steps: 20 });
  await page.mouse.up();
  s = await viewState(page);
  expect(s.focus.x).toBeGreaterThanOrEqual((80 - 41) / scale);
  expect(s.focus.x).toBeLessThanOrEqual((80 - 36) / scale);
  expect(s.focus.y).toBe(focusY);
});

test('measures with Shift + drag', async ({ page }) => {
  await prepare(page, 'json-sample.rcg.gz');
  await show(page, {});
  const box = await page.locator('.field-view').boundingBox();
  if (!box) {
    throw new Error('no field view');
  }
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + 500, box.y + 345);
  await page.mouse.down();
  await page.mouse.move(box.x + 600, box.y + 400, { steps: 4 });
  await page.evaluate(() => (window.rcssmonitorWeb as Hook).renderNow());
  await expect(page.locator('.field-view')).toHaveScreenshot('measure.png', {
    maxDiffPixelRatio: 0.005,
  });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  // The focus did not move.
  expect((await viewState(page)).focus).toEqual({ x: 0, y: 0 });
});

test('selects players and toggles the view with the keyboard', async ({ page }) => {
  await prepare(page, 'json-sample.rcg.gz');
  await show(page, {});
  await page.keyboard.press('5');
  expect((await viewState(page)).selected).toEqual({ side: 1, unum: 5 });
  await page.keyboard.press('Control+3');
  expect((await viewState(page)).selected).toEqual({ side: -1, unum: 3 });
  await page.keyboard.press('u');
  expect((await viewState(page)).selected).toBeNull();
  await page.keyboard.press('b');
  expect((await viewState(page)).focusType).toBe('ball');
  await page.keyboard.press('v');
  expect(await page.evaluate(() => (window.rcssmonitorWeb as Hook).view.options.showViewArea)).toBe(
    true,
  );
});

test('steps through the frames with the arrow keys and the slider', async ({ page }) => {
  await prepare(page, 'json-sample.rcg.gz');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#frame-label')).toHaveText('3 (3 / 267)');
  await page.keyboard.press('End');
  await expect(page.locator('#frame-label')).toHaveText('6000 (267 / 267)');
  await page.locator('#frame-slider').fill('207');
  await expect(page.locator('#frame-label')).toHaveText('1746.1 (208 / 267)');
  await page.keyboard.press('Home');
  await expect(page.locator('#frame-label')).toHaveText('1 (1 / 267)');
});

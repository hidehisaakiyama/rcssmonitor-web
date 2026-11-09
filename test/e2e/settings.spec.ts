import { expect, test, type Page } from '@playwright/test';
import type { AppSettings } from '../../src/options/settings';
import type { ViewState } from '../../src/view/view-state';
import { loadLog, openApp, requireBuild } from './helpers';

// Phase 5: the menu bar, the preference, player type, shortcut and about
// dialogs, the window toggles and the saved settings.
requireBuild();

const app = (page: Page) =>
  page.evaluate(() => {
    const a = (window.rcssmonitorWeb as { app: { view: ViewState; settings: AppSettings } }).app;
    return {
      options: a.view.options,
      colors: a.view.colors,
      fonts: a.view.fonts,
      selectType: a.view.selectType,
      selected: a.view.selected,
      settings: a.settings,
    };
  });

test('opens the menus with the mouse and the keyboard', async ({ page }) => {
  await openApp(page);
  await page.locator('#menu-file').click();
  await expect(page.locator('#menu-file-list')).toBeVisible();
  await expect(page.locator('#file-open')).toContainText('Ctrl+O');
  // With a menu open, the mouse over another title opens that one.
  await page.locator('#menu-monitor').hover();
  await expect(page.locator('#menu-monitor-list')).toBeVisible();
  await expect(page.locator('#menu-file-list')).toHaveCount(0);
  await expect(page.locator('#monitor-disconnect')).toBeDisabled();
  await expect(page.locator('#monitor-live')).toBeDisabled();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#monitor-connect')).toBeFocused();
  // Right and Left move along the menu bar, also through a menu without enabled items.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#menu-referee-list')).toBeVisible();
  await expect(page.locator('#referee-kick-off')).toBeDisabled();
  await expect(page.locator('#referee-change-playmode')).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#view-menu-bar')).toBeFocused();
  await expect(page.locator('#view-menu-bar')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#menu-monitor-list')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-monitor-list')).toHaveCount(0);
  // A second click on the title closes its menu.
  await page.locator('#menu-help').click();
  await page.locator('#menu-help').click();
  await expect(page.locator('#menu-help-list')).toHaveCount(0);
});

test('shows and hides the bars, and keeps that', async ({ page }) => {
  await openApp(page);
  await page.locator('#menu-view').click();
  await page.locator('#view-tool-bar').click();
  await expect(page.locator('.toolbar')).toBeHidden();
  await page.locator('#menu-view').click();
  await page.locator('#view-status-bar').click();
  await expect(page.locator('.statusbar')).toBeHidden();
  await page.keyboard.press('Control+m');
  await expect(page.locator('.menubar')).toBeHidden();

  await page.reload();
  await expect(page.locator('.menubar')).toBeHidden();
  await expect(page.locator('.toolbar')).toBeHidden();
  await page.keyboard.press('Control+m');
  await expect(page.locator('.menubar')).toBeVisible();
  await page.locator('#menu-view').click();
  await expect(page.locator('#view-tool-bar')).toHaveAttribute('aria-checked', 'false');
  await page.locator('#view-tool-bar').click();
  await expect(page.locator('.toolbar')).toBeVisible();
});

test('changes the view in the preference dialog and keeps it', async ({ page }) => {
  await openApp(page);
  await loadLog(page, 'json-sample.rcg.gz');
  await page.keyboard.press('Control+v');
  const dialog = page.locator('#config-dialog');
  await expect(dialog).toBeVisible();

  await page.locator('#config-showFlag').check();
  expect((await app(page)).options.showFlag).toBe(true);
  // Keys still work on the field, and the dialog follows them.
  await page.mouse.click(200, 400);
  await page.keyboard.press('n');
  await expect(page.locator('#config-showPlayerNumber')).not.toBeChecked();
  await page.keyboard.press('a');
  await expect(page.locator('#config-select-autoAll')).toBeChecked();
  // Fix keeps the player chosen automatically (rcssmonitor sets Auto right).
  await page.locator('#config-select-fix').check();
  let s = await app(page);
  expect(s.selectType).toBe('fix');
  expect(s.selected).not.toBeNull();
  await page.locator('#config-selected-player').selectOption('Right number: 5');
  expect((await app(page)).selected).toEqual({ side: -1, unum: 5 });

  await page.locator('#config-tab-canvas').click();
  await page.locator('#config-canvas-width').fill('640');
  await page.locator('#config-canvas-height').fill('480');
  await page.locator('#config-canvas-apply').click();
  await expect
    .poll(async () => {
      const box = await page.locator('.field-view').boundingBox();
      return [Math.round(box?.width ?? 0), Math.round(box?.height ?? 0)];
    })
    .toEqual([640, 480]);
  await page.locator('#config-grid-step').fill('10');
  await page.locator('#config-grid-step').press('Enter');

  await page.locator('#config-tab-color').click();
  await page.locator('#config-color-field').fill('#ff0000');
  await page.locator('#config-tab-font').click();
  await page.locator('#config-font-player-size').fill('12');
  await page.locator('#config-font-player-size').press('Enter');
  s = await app(page);
  expect(s.colors.field).toBe('#ff0000');
  expect(s.fonts.player.size).toBe(16); // 12 pt
  expect(s.options.gridStep).toBe(10);

  // The settings are kept.
  await page.reload();
  s = await app(page);
  expect(s.options.showFlag).toBe(true);
  expect(s.options.showPlayerNumber).toBe(false);
  expect(s.options.gridStep).toBe(10);
  expect(s.colors.field).toBe('#ff0000');
  expect(s.fonts.player.size).toBe(16);
  expect(s.settings.canvasWidth).toBe(640);

  // Default and Cancel in the color tab.
  await page.keyboard.press('Control+v');
  await page.locator('#config-tab-color').click();
  await page.locator('#config-color-ball').fill('#00ff00');
  await page.locator('#config-color-cancel').click();
  s = await app(page);
  expect(s.colors.ball).toBe('#ffffff');
  expect(s.colors.field).toBe('#ff0000');
  await page.locator('#config-color-default').click();
  expect((await app(page)).colors.field).toBe('#1fa01f');
  await page.locator('#config-dialog-close').click();
  await expect(dialog).toBeHidden();
});

test('takes settings from the URL without saving them', async ({ page }) => {
  await openApp(page, '?show_flag=on&field_brush=0000ff&show-tool-bar=off&timer_interval=50');
  let s = await app(page);
  expect(s.options.showFlag).toBe(true);
  expect(s.colors.field).toBe('#0000ff');
  await expect(page.locator('.toolbar')).toBeHidden();
  await loadLog(page, 'json-sample.rcg.gz');
  await page.keyboard.press('Space');
  await expect(page.locator('#speed-label')).toHaveText('50 ms');

  await openApp(page);
  s = await app(page);
  expect(s.options.showFlag).toBe(false);
  expect(s.colors.field).toBe('#1fa01f');
  await expect(page.locator('.toolbar')).toBeVisible();
});

test('lists the player types and sorts them', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('Control+h');
  await expect(page.locator('#player-types-empty')).toBeVisible();
  await loadLog(page, 'json-sample.rcg.gz');
  const rows = page.locator('#player-types tbody tr');
  await expect(rows).toHaveCount(18);
  await expect(page.locator('#player-types-empty')).toBeHidden();
  await expect(rows.first().locator('td').nth(2)).toHaveText('1.000 / 1.050');

  const decay = page.locator('#player-types th').nth(5);
  await decay.locator('button').click();
  await expect(decay).toHaveAttribute('aria-sort', 'ascending');
  await expect(rows.first().locator('td').nth(5)).toHaveText('0.302831');
  await decay.locator('button').click();
  await expect(decay).toHaveAttribute('aria-sort', 'descending');
  await expect(rows.first().locator('td').nth(5)).toHaveText('0.499465');
  await page.locator('#player-types').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#player-type-dialog')).toBeHidden();
});

test('shows the shortcut keys and the version', async ({ page }) => {
  await openApp(page);
  await page.locator('#menu-help').click();
  await page.locator('#help-shortcuts').click();
  const table = page.locator('#shortcut-table');
  await expect(table).toBeVisible();
  await expect(table).toContainText('Ctrl+K');
  await expect(table).toContainText('Send the kick-off command');
  await page.locator('#shortcut-dialog-close').click();

  await page.locator('#menu-help').click();
  await page.locator('#help-about').click();
  await expect(page.locator('#about-version')).toHaveText(/^rcssmonitor-web \d+\.\d+\.\d+/);
  await page.locator('#about-dialog-ok').click();
  await expect(page.locator('#about-dialog')).toHaveCount(0);
});

test('goes full screen', async ({ page, browserName }) => {
  await openApp(page);
  test.skip(
    !(await page.evaluate(() => document.fullscreenEnabled)),
    `no Fullscreen API in headless ${browserName}`,
  );
  await page.keyboard.press('F11');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await page.locator('#menu-view').click();
  await expect(page.locator('#view-full-screen')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#view-full-screen').click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(false);
});

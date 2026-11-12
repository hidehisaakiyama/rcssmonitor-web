import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { fixture, loadLog, openApp, requireBuild } from './helpers';

// The log player: opening files, play / stop, speed, stepping, jumps.
requireBuild();

const label = (page: Page) => page.locator('#frame-label');
const playButton = (page: Page) => page.locator('#play-button');

test('plays and stops with Space and the play button', async ({ page }) => {
  await openApp(page);
  await loadLog(page, 'json-sample.rcg.gz');
  await expect(label(page)).toHaveText('1 (1 / 267)');
  await expect(page).toHaveTitle('json-sample.rcg.gz - rcssmonitor-web');

  await page.keyboard.press('Space');
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(label(page)).not.toHaveText('1 (1 / 267)');
  await page.keyboard.press('Space');
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'false');
  const stopped = await label(page).textContent();
  await page.waitForTimeout(300);
  await expect(label(page)).toHaveText(stopped ?? '');

  await playButton(page).click();
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'true');
  await playButton(page).click();
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('stops with the play button pressed as long as a person does', async ({ page }) => {
  // A person holds the button for a tenth of a second or so, while several
  // frames go by. The tool bar used to redraw the button's icon at every
  // frame, so the press and the release were on different elements and
  // the browser made no click of them.
  await openApp(page);
  await loadLog(page, 'json-sample.rcg.gz');
  const box = await playButton(page).boundingBox();
  if (!box) {
    throw new Error('the play button is not shown');
  }
  const press = async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();
  };
  await press();
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(label(page)).not.toHaveText('1 (1 / 267)');
  await press();
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('changes the speed while playing', async ({ page }) => {
  await openApp(page);
  await loadLog(page, 'json-sample.rcg.gz');
  const speed = page.locator('#speed-label');
  await expect(speed).toHaveText('100 ms');
  await page.keyboard.press('Control+ArrowUp'); // stopped: no effect
  await expect(speed).toHaveText('100 ms');
  await page.keyboard.press('Space');
  await page.keyboard.press('Control+ArrowUp');
  await expect(speed).toHaveText('50 ms');
  await page.locator('#decelerate-button').click();
  await page.locator('#decelerate-button').click();
  await expect(speed).toHaveText('200 ms');
  await page.keyboard.press('Space');
});

test('plays to the end and stops there', async ({ page }) => {
  await openApp(page);
  await loadLog(page, 'json-pk.rcg.gz');
  await page.keyboard.press('Space');
  for (let i = 0; i < 5; ++i) {
    await page.keyboard.press('Control+ArrowUp');
  }
  await expect(page.locator('#speed-label')).toHaveText('5 ms');
  await expect(label(page)).toHaveText('6040 (43 / 43)');
  await expect(playButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('steps with the keys, the buttons and the wheel', async ({ page }) => {
  await openApp(page);
  await loadLog(page, 'json-sample.rcg.gz');
  await page.keyboard.press('ArrowRight');
  await page.locator('#step-forward-button').click();
  await expect(label(page)).toHaveText('3 (3 / 267)');
  await page.locator('#step-backward-button').click();
  await expect(label(page)).toHaveText('2 (2 / 267)');

  const box = await page.locator('.field-view').boundingBox();
  if (!box) {
    throw new Error('no field view');
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 100); // down: forward
  await expect(label(page)).toHaveText('4 (4 / 267)');
  await page.mouse.wheel(0, -50);
  await expect(label(page)).toHaveText('3 (3 / 267)');

  await page.keyboard.press('End');
  await expect(label(page)).toHaveText('6000 (267 / 267)');
  await page.keyboard.press('ArrowRight'); // no loop: stays
  await expect(label(page)).toHaveText('6000 (267 / 267)');
  await page.locator('#loop-button').click();
  await expect(page.locator('#loop-button')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight'); // loop: wraps
  await expect(label(page)).toHaveText('1 (1 / 267)');
});

test('jumps to the goals, to a cycle and with the slider', async ({ page }) => {
  await openApp(page);
  await loadLog(page, 'text-v5-sample.rcg.gz');
  // The goal is at frame 249 (cycle 6713); the jump lands 50 frames before
  // the frame rcssmonitor records, the one before the goal.
  await page.keyboard.press('g');
  await expect(label(page)).toHaveText('198 (198 / 312)');
  await page.keyboard.press('End');
  await page.locator('#prev-score-button').click();
  await expect(label(page)).toHaveText('198 (198 / 312)');
  await page.keyboard.press('Home');
  await page.locator('#next-score-button').click();
  await expect(label(page)).toHaveText('198 (198 / 312)');
  await page.keyboard.press('Control+g');
  await expect(label(page)).toHaveText('198 (198 / 312)'); // no earlier goal

  const cycle = page.locator('#cycle-input');
  await cycle.fill('789');
  await cycle.press('Enter');
  await expect(label(page)).toHaveText('789 (205 / 312)');
  await expect(cycle).not.toBeFocused();
  await cycle.fill('9000');
  await cycle.press('Enter');
  await expect(cycle).toHaveClass(/invalid/);
  await expect(label(page)).toHaveText('789 (205 / 312)');
  await cycle.press('Escape');

  await page.locator('#frame-slider').fill('249');
  await expect(label(page)).toHaveText('6713.1 (250 / 312)');
});

test('opens a file dropped on the window', async ({ page }) => {
  await openApp(page);
  const data = readFileSync(fixture('json-pk.rcg.gz')).toString('base64');
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'dropped.rcg.gz'));
    const target = document.querySelector('.field-view');
    if (!target) {
      throw new Error('no field view');
    }
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }),
      );
    }
  }, data);
  await expect(page.locator('#load-result')).toContainText(
    'dropped.rcg.gz: JSON (gzip), 43 frames',
  );
  await expect(page.locator('#app')).not.toHaveClass(/drop-target/);
});

test('opens the file chooser with Ctrl+O', async ({ page }) => {
  await openApp(page);
  const chooser = page.waitForEvent('filechooser');
  // waitForEvent() turns on file chooser interception asynchronously; a
  // round trip to the page lets it take effect before the key press.
  await page.evaluate(() => 0);
  await page.keyboard.press('Control+o');
  await (await chooser).setFiles(fixture('text-v5-sample.rcg.gz'));
  await expect(page.locator('#load-result')).toContainText('text-v5-sample.rcg.gz: text v5');
});

test('keeps the buttons disabled until a log is open', async ({ page }) => {
  await openApp(page);
  await expect(playButton(page)).toBeDisabled();
  await expect(page.locator('#open-button')).toBeEnabled();
  await page.keyboard.press('Space'); // nothing to play
  await expect(label(page)).toHaveText('');
});

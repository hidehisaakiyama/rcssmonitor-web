import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fixture, loadLog, openApp, requireBuild, type Hook } from './helpers';

// Loads game logs through the inline parsing worker of the single-file build.
requireBuild();

for (const [name, summary] of [
  ['json-sample.rcg.gz', 'JSON (gzip), 267 frames, cycles 1-6000, HELIOS2023 0-0 CYRUS'],
  ['text-v5-sample.rcg.gz', 'text v5 (gzip), 312 frames, cycles 1-8000, HELIOS2022 1-0 CYRUS'],
] as const) {
  test(`loads ${name} from file://`, async ({ page }) => {
    await openApp(page);
    await page.setInputFiles('#rcg-file', fixture(name));
    await expect(page.locator('#load-result')).toHaveText(`${name}: ${summary}`);
    await expect(page.locator('#frame-label')).toHaveText(/^1 \(1 \/ \d+\)$/);
  });
}

test('shows the penalty shoot-out of json-pk.rcg.gz on the score board', async ({ page }) => {
  await openApp(page);
  await loadLog(page, 'json-pk.rcg.gz');
  const board = await page.evaluate(() => {
    const hook = window.rcssmonitorWeb as Hook;
    hook.showFrame(30);
    return hook.scoreBoard();
  });
  expect(board).toContain('|oxoo :oox  |');
});

test('reports an unsupported file', async ({ page }) => {
  await openApp(page);
  await page.setInputFiles('#rcg-file', {
    name: 'old.rcg',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from([0x55, 0x4c, 0x47, 3, 0, 0]),
  });
  await expect(page.locator('#load-result')).toHaveText(
    'old.rcg: unsupported log format: binary v3 (not supported)',
  );
});

// Full-length logs are not in the repository (see test/unit/full-logs.test.ts).
for (const [name, frames] of [
  ['1-json.rcg.gz', '6,209 frames'],
  ['202207160432-HELIOS2022_1-vs-CYRUS_0.rcg.gz', '8,406 frames'],
] as const) {
  const path = fixture(`full/${name}`);
  test(`loads the full log ${name}`, async ({ page }, info) => {
    test.skip(!existsSync(path), 'full-length log not present');
    await openApp(page);
    const started = Date.now();
    await page.setInputFiles('#rcg-file', path);
    await expect(page.locator('#load-result')).toContainText(frames, { timeout: 30_000 });
    console.log(`[${info.project.name}] ${name}: ${Date.now() - started} ms`);
  });
}

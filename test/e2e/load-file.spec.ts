import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

// Opens the single-file build from file://, as users on a LAN do, and loads
// game logs through the inline parsing worker.
const singleHtml = fileURLToPath(
  new URL('../../dist-single/rcssmonitor-web.html', import.meta.url),
);
const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

test.beforeAll(() => {
  if (!existsSync(singleHtml)) {
    throw new Error(
      'dist-single/rcssmonitor-web.html not found; run `npm run build:single` first.',
    );
  }
});

const detail = (page: import('@playwright/test').Page, term: string) =>
  page.locator('#log-details dt', { hasText: term }).locator('xpath=following-sibling::dd[1]');

for (const [name, summary, scoreChanges, logos] of [
  [
    'json-sample.rcg.gz',
    'JSON (gzip), 267 frames, cycles 1-6000, HELIOS2023 0-0 CYRUS',
    'none',
    'left 256x64, right none',
  ],
  [
    'text-v5-sample.rcg.gz',
    'text v5 (gzip), 312 frames, cycles 1-8000, HELIOS2022 1-0 CYRUS',
    '6713 (1-0)',
    'left 256x64, right 256x64',
  ],
] as const) {
  test(`loads ${name} from file://`, async ({ page }) => {
    await page.goto(pathToFileURL(singleHtml).href);
    await page.setInputFiles('#rcg-file', fixture(name));
    await expect(page.locator('#load-result')).toHaveText(`${name}: ${summary}`);
    await expect(detail(page, 'Score changes')).toHaveText(scoreChanges);
    await expect(detail(page, 'Team logos')).toHaveText(logos);
    await expect(detail(page, 'Warnings')).toHaveText('none');
  });
}

test('shows the penalty shoot-out of json-pk.rcg.gz', async ({ page }) => {
  await page.goto(pathToFileURL(singleHtml).href);
  await page.setInputFiles('#rcg-file', fixture('json-pk.rcg.gz'));
  await expect(page.locator('#load-result')).toContainText('43 frames');
  await expect(detail(page, 'Penalty shoot-out')).toHaveText('oxooo : ooxox');
});

test('reports an unsupported file', async ({ page }) => {
  await page.goto(pathToFileURL(singleHtml).href);
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
    await page.goto(pathToFileURL(singleHtml).href);
    await page.setInputFiles('#rcg-file', path);
    await expect(page.locator('#load-result')).toContainText(frames, { timeout: 30_000 });
    const loadTime = await detail(page, 'Load time').textContent();
    console.log(`[${info.project.name}] ${name}: ${loadTime}`);
  });
}

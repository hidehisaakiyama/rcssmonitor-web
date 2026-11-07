import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

// Opens the single-file build from file://, as users on a LAN do, and checks
// that the inline worker decompresses and identifies the fixtures.
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

for (const [name, expected] of [
  ['json-sample.rcg.gz', 'JSON, gzip, 2,335,974 bytes'],
  ['text-v5-sample.rcg.gz', 'text v5, gzip, 1,117,172 bytes'],
] as const) {
  test(`identifies ${name} from file://`, async ({ page }) => {
    await page.goto(pathToFileURL(singleHtml).href);
    await page.setInputFiles('#rcg-file', fixture(name));
    await expect(page.locator('#load-result')).toHaveText(`${name}: ${expected}`);
  });
}

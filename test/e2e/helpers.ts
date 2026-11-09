import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { FieldView } from '../../src/ui/field-view';
import type { ViewOptions, ViewState } from '../../src/view/view-state';

export const singleHtml = fileURLToPath(
  new URL('../../dist-single/rcssmonitor-web.html', import.meta.url),
);
export const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

declare global {
  interface Window {
    rcssmonitorWeb?: unknown;
  }
}

/** The hooks main.ts puts on window.rcssmonitorWeb. */
export interface Hook {
  view: ViewState;
  field: FieldView;
  showFrame(index: number): void;
  scoreBoard(): string;
  renderNow(): void;
}

export function requireBuild(): void {
  test.beforeAll(() => {
    if (!existsSync(singleHtml)) {
      throw new Error(
        'dist-single/rcssmonitor-web.html not found; run `npm run build:single` first.',
      );
    }
  });
}

/** Opens the single-file build from file://, as users on a LAN do. */
export async function openApp(page: Page): Promise<void> {
  await page.goto(pathToFileURL(singleHtml).href);
}

export async function loadLog(page: Page, name: string): Promise<void> {
  await page.setInputFiles('#rcg-file', fixture(name));
  await expect(page.locator('#load-result')).toContainText('frames');
}

/**
 * Draws all text with a bundled subset of DejaVu Sans, so that screenshots
 * do not depend on the fonts installed on the machine.
 */
export async function useTestFonts(page: Page): Promise<void> {
  const data = (file: string) => readFileSync(fixture(`fonts/${file}`)).toString('base64');
  await page.addStyleTag({
    content:
      `@font-face { font-family: TestSans; font-weight: normal; ` +
      `src: url(data:font/woff;base64,${data('DejaVuSans-ascii.woff')}); }\n` +
      `@font-face { font-family: TestSans; font-weight: bold; ` +
      `src: url(data:font/woff;base64,${data('DejaVuSans-Bold-ascii.woff')}); }`,
  });
  await page.evaluate(async () => {
    await document.fonts.load('12px TestSans');
    await document.fonts.load('bold 12px TestSans');
    const hook = window.rcssmonitorWeb as Hook;
    for (const f of Object.values(hook.view.fonts)) {
      f.family = 'TestSans';
    }
    hook.view.changed();
  });
}

/** Fixes the size of the field view in CSS pixels. */
export async function setFieldSize(page: Page, width: number, height: number): Promise<void> {
  await page.evaluate(
    ({ width, height }) => {
      const el = (window.rcssmonitorWeb as Hook).field.element;
      el.style.flex = 'none';
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
    },
    { width, height },
  );
}

export interface Scene {
  frame?: number;
  options?: Partial<ViewOptions>;
  select?: number;
}

/** Shows a frame with view options and draws it at once. */
export async function show(page: Page, scene: Scene): Promise<void> {
  await page.evaluate((s) => {
    const hook = window.rcssmonitorWeb as Hook;
    Object.assign(hook.view.options, s.options ?? {});
    if (s.select) {
      hook.view.selectPlayer(s.select);
    }
    hook.view.changed();
    hook.showFrame(s.frame ?? 0);
    hook.renderNow();
  }, scene);
}

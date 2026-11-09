import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'dist-single/',
      'coverage/',
      'test-results/',
      'playwright-report/',
      'spike/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    // core/ and io/ must run in a Worker, in Node (tests, replay server) and
    // under both renderers, so they may not touch the DOM or the UI layers.
    files: ['src/core/**/*.ts', 'src/io/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'localStorage',
        'sessionStorage',
        'navigator',
        'HTMLElement',
        'HTMLCanvasElement',
        'CanvasRenderingContext2D',
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/view/**', '**/ui/**', '**/playback/**', '**/options/**'],
              message: 'core/ and io/ must not depend on the view, UI, playback or options layers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['*.config.{js,ts}', 'tools/**/*.{js,mjs}', 'test/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Playwright scripts: page.evaluate() callbacks run in the browser.
    files: ['tools/parity/**/*.mjs', 'test/e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  prettier,
);

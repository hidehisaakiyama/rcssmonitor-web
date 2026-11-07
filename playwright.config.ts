import { defineConfig, devices } from '@playwright/test';

// The end-to-end tests open the single-file build from file://, the same way
// users on a LAN open it. Run `npm run build:single` before `npm run test:e2e`.
export default defineConfig({
  testDir: 'test/e2e',
  forbidOnly: !!process.env['CI'],
  reporter: process.env['CI'] ? 'github' : 'list',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});

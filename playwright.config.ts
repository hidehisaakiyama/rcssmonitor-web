import { defineConfig, devices } from '@playwright/test';

// The end-to-end tests open the single-file build from file://, the same way
// users on a LAN open it. Run `npm run build:single` before `npm run test:e2e`.
//
// Headless Firefox draws WebGL with the machine's GPU, headless Chromium in
// software. Many Firefox at once on the GPU, beside the desktop's own use,
// ran into a GPU reset that took down the desktop session
// (DEVELOPMENT_PLAN.md §9, Phase 6). Firefox gets Mesa's software rendering
// here too (LIBGL_ALWAYS_SOFTWARE), as on the CI's virtual display. To
// measure the frame rate on the GPU, run a browser outside the tests.
const softwareGl: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  ),
  LIBGL_ALWAYS_SOFTWARE: '1',
};

export default defineConfig({
  testDir: 'test/e2e',
  forbidOnly: !!process.env['CI'],
  reporter: process.env['CI'] ? 'github' : 'list',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], launchOptions: { env: softwareGl } },
    },
  ],
});

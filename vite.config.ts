import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

/** The short commit hash, shown in Help > About; empty outside a git checkout. */
function commit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

// Two builds:
// - default: multi-file build for GitHub Pages (dist/)
// - "single": one HTML file that works from file:// (dist-single/)
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __APP_COMMIT__: JSON.stringify(commit()),
    },
    // Workers are inlined as classic (IIFE) scripts: Chrome refuses to start
    // a module worker from a Blob URL when the page is opened from file://.
    worker: { format: 'iife' },
    build: {
      outDir: single ? 'dist-single' : 'dist',
      target: 'es2022',
      // three.js makes the 3D chunk (and the single file) about 600 kB.
      chunkSizeWarningLimit: 800,
    },
    plugins: single ? [viteSingleFile()] : [],
  };
});

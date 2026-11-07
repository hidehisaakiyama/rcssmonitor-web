import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Two builds:
// - default: multi-file build for GitHub Pages (dist/)
// - "single": one HTML file that works from file:// (dist-single/)
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    // Workers are inlined as classic (IIFE) scripts: Chrome refuses to start
    // a module worker from a Blob URL when the page is opened from file://.
    worker: { format: 'iife' },
    build: {
      outDir: single ? 'dist-single' : 'dist',
      target: 'es2022',
    },
    plugins: single ? [viteSingleFile()] : [],
  };
});

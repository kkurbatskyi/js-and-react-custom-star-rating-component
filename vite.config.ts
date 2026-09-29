/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Modes
 * - default:              `dist/` — multi-file build for GitHub Pages / any static host.
 *                         `BASE=/repo-name/` overrides the (relative) public base path.
 * - `--mode artifact`:    `dist-artifact/index.html` with every script and style inlined
 *                         (vite-plugin-singlefile); `scripts/make-artifact.mjs` then turns it
 *                         into the host fragment `dist-artifact/sidereal.html`.
 *
 * `VITE_CACHE_DIR` lets several dev servers run side by side without fighting over the
 * dependency pre-bundle cache (see docs/ARCHITECTURE.md §11).
 */
export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact';

  return {
    base: process.env.BASE ?? './',
    cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
    plugins: [react(), ...(artifact ? [viteSingleFile()] : [])],

    server: {
      host: '127.0.0.1',
    },
    preview: {
      host: '127.0.0.1',
    },

    optimizeDeps: {
      // Pre-bundle up front so a late discovery never triggers a full reload mid-screenshot.
      include: [
        'three',
        'three/examples/jsm/controls/OrbitControls.js',
        'postprocessing',
        'lil-gui',
        'react',
        'react-dom/client',
        'react/jsx-runtime',
        'zustand',
      ],
    },

    build: {
      target: 'es2022',
      outDir: artifact ? 'dist-artifact' : 'dist',
      emptyOutDir: true,
      sourcemap: !artifact,
      // Everything is inlined in artifact mode, so there is nothing to preload.
      modulePreload: artifact ? false : { polyfill: true },
      // three.js alone is ~700 kB minified; the app ships as one chunk by design.
      chunkSizeWarningLimit: 2000,
    },

    test: {
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}'],
      // UI tests opt into a DOM per file with a `// @vitest-environment happy-dom` docblock.
      passWithNoTests: true,
    },
  };
});

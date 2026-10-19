import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Plain multi-entry build: popup + options pages, plus the MV3 service worker at a fixed path
// (manifest.json points at background.js). public/ (manifest, icons) is copied as-is.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome116',
    modulePreload: { polyfill: false },
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: r('./popup.html'),
        options: r('./options.html'),
        background: r('./src/background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});

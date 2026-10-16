import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { copy } from '../server/src/config/copy.ts';

/** The one wording file (spec rule 6), shared with the server. */
const copyFile = fileURLToPath(new URL('../server/src/config/copy.ts', import.meta.url));

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Fills the page title and <noscript> text in index.html from the wording file. */
function wordingInHtml(): Plugin {
  return {
    name: 'adn-wording-in-html',
    transformIndexHtml: (html) =>
      html
        .replace('%ADN_TITLE%', escapeHtml(copy.widget.documentTitle))
        .replace('%ADN_NOSCRIPT%', escapeHtml(copy.widget.noscript)),
  };
}

export default defineConfig({
  // The server serves the build at /widget.
  base: '/widget/',
  plugins: [react(), wordingInHtml()],
  resolve: {
    alias: { '@adn/copy': copyFile },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    // `npm run dev:widget` (http://localhost:5173/widget/) talks to the API on port 3000.
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
  },
});

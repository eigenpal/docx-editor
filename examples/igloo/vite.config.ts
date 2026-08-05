import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'path';
import type { Plugin } from 'vite';

const monorepoRoot = path.resolve(__dirname, '../..');

/**
 * Serve the demo document from ONE byte source, the way the Vite example does.
 *
 * The default is that example's own `sample.docx` — the same document a visitor to the
 * public demo opens — read straight out of `examples/vite/public/`. Copying it here would
 * create a second copy that silently drifts from the one everybody else sees, and the same
 * argument holds for the e2e fixtures below.
 */
function canonicalFixturePlugin(): Plugin {
  const fixtures = new Map([
    ['/sample.docx', path.join(monorepoRoot, 'examples/vite/public/sample.docx')],
    [
      '/comprehensive-word-element-test.docx',
      path.join(monorepoRoot, 'e2e/fixtures/comprehensive-word-element-test.docx'),
    ],
  ]);
  return {
    name: 'igloo-canonical-fixture',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const source = req.url ? fixtures.get(req.url.split('?')[0]!) : undefined;
        if (!source) return next();
        readFile(source)
          .then((bytes) => {
            res.setHeader(
              'Content-Type',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            );
            res.end(bytes);
          })
          .catch(next);
      });
    },
    async generateBundle() {
      for (const [url, source] of fixtures) {
        this.emitFile({ type: 'asset', fileName: url.slice(1), source: await readFile(source) });
      }
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), canonicalFixturePlugin()],
  root: __dirname,
  resolve: {
    // Workspace source aliases, so editing the library repaints the demo. Mirrors
    // `examples/vite/vite.config.ts`; ordered most-specific first.
    alias: [
      {
        find: '@docx-editor.dev/react',
        replacement: path.join(monorepoRoot, 'packages/react/src/index.ts'),
      },
      {
        find: '@docx-editor.dev/core/editor',
        replacement: path.join(monorepoRoot, 'packages/core/src/editor/index.ts'),
      },
      {
        find: /^@docx-editor\.dev\/core\/(binding|layout|output|store|sync|clients|server)$/,
        replacement: path.join(monorepoRoot, 'packages/core/src/$1/index.ts'),
      },
      {
        find: /^@docx-editor\.dev\/core\/contracts\/(.+)$/,
        replacement: path.join(monorepoRoot, 'packages/core/src/contracts/$1.ts'),
      },
      {
        find: '@docx-editor.dev/i18n',
        replacement: path.join(monorepoRoot, 'packages/i18n/src/index.ts'),
      },
    ],
  },
  // The library's chrome is Tailwind scoped to `.ep-root` (see the monorepo preset), so a
  // host embedding it must run the same layer or half the packaged controls render unstyled.
  css: {
    postcss: {
      plugins: [
        tailwindcss({ config: path.join(monorepoRoot, 'tailwind.config.js') }),
        autoprefixer(),
      ],
    },
  },
  server: { port: 5178 },
});

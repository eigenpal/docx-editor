import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { stripUnexpandedTailwind } from '../shared/strip-unexpanded-tailwind';
import path from 'path';
import type { Plugin } from 'vite';

const monorepoRoot = path.resolve(__dirname, '../..');

/**
 * Serve the SHARED document from one byte source, the way the Vite example does.
 *
 * This demo's own default lives in `public/` (it has an iceberg and an igloo in it, and
 * nothing else reads it). The one thing reachable through `?fixture=` is somebody else's
 * file, the Vite example's `sample.docx`, so it is mapped onto the real path rather than
 * copied here, where a second copy would silently drift.
 *
 * Nothing under `e2e/fixtures/` belongs here. Those files exist to make assertions fail,
 * they change whenever a test needs them to, and this demo is deployed: a fixture edit made
 * for a test run would ship as a demo document nobody meant to publish.
 */
function canonicalFixturePlugin(): Plugin {
  const fixtures = new Map([
    ['/sample.docx', path.join(monorepoRoot, 'examples/vite/public/sample.docx')],
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
    // `examples/vite/vite.config.ts`; ordered most-specific first. `pro` belongs here too:
    // without it this demo ran the last BUILT `packages/pro/dist`, so a library fix looked
    // like it had not worked.
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
        find: '@docx-editor.dev/pro/react',
        replacement: path.join(monorepoRoot, 'packages/pro/src/react/index.ts'),
      },
      {
        find: '@docx-editor.dev/pro',
        replacement: path.join(monorepoRoot, 'packages/pro/src/index.ts'),
      },
      {
        find: '@docx-editor.dev/i18n',
        replacement: path.join(monorepoRoot, 'packages/i18n/src/index.ts'),
      },
    ],
  },
  // The library's chrome is Tailwind scoped to `.docx-editor` (see the monorepo preset), so a
  // host embedding it must run the same layer or half the packaged controls render unstyled.
  css: {
    postcss: {
      plugins: [
        tailwindcss({ config: path.join(monorepoRoot, 'tailwind.config.js') }),
        autoprefixer(),
        stripUnexpandedTailwind,
      ],
    },
  },
  server: { port: 5178 },
});

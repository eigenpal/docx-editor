import { defineConfig, type Plugin } from 'vite';
import { readFile } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { stripUnexpandedTailwind } from '../shared/strip-unexpanded-tailwind';
import path from 'path';

const monorepoRoot = path.resolve(__dirname, '../..');

/**
 * Serve the demo document from ONE byte source.
 *
 * `examples/vite/public/sample.docx` is the document the public demo opens. Copying it
 * here would create a second file that drifts, so this maps the URL onto that one at
 * request time, and `build` copies the same bytes into the output.
 */
function sampleDocumentPlugin(): Plugin {
  const source = path.join(monorepoRoot, 'examples/vite/public/sample.docx');
  return {
    name: 'happy-path-sample-document',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ? req.url.split('?')[0] : '') !== '/sample.docx') return next();
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
      this.emitFile({
        type: 'asset',
        fileName: 'sample.docx',
        source: new Uint8Array(await readFile(source)),
      });
    },
  };
}

// `USE_PUBLISHED_PACKAGES=true` drops the source aliases below, so vite resolves the
// package names through node_modules and hits the built `dist/` — the same code path an
// `npm install` consumer gets, including the bundled HarfBuzz runtime and its `.wasm`.
// Run it that way to check what ships, rather than what the working tree compiles to.
const usePublished = process.env.USE_PUBLISHED_PACKAGES === 'true';

export default defineConfig({
  plugins: [react(), sampleDocumentPlugin()],
  root: __dirname,
  resolve: {
    // Resolve package imports to SOURCE, so this app runs the working tree rather than a
    // stale `dist/`. Order matters: more-specific prefixes before less-specific ones.
    // Every package points its export map at `dist/`, so a specifier missing here
    // resolves through node_modules to a build instead.
    alias: usePublished
      ? []
      : [
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
            find: '@docx-editor.dev/fonts/google',
            replacement: path.join(monorepoRoot, 'packages/fonts/src/google-fonts.ts'),
          },
          {
            find: '@docx-editor.dev/fonts',
            replacement: path.join(monorepoRoot, 'packages/fonts/src/index.ts'),
          },
          {
            find: '@docx-editor.dev/i18n',
            replacement: path.join(monorepoRoot, 'packages/i18n/src/index.ts'),
          },
        ],
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss({ config: path.join(monorepoRoot, 'tailwind.config.js') }),
        autoprefixer(),
        stripUnexpandedTailwind,
      ],
    },
  },
  server: {
    port: 5175,
    open: false,
  },
  build: {
    outDir: 'dist',
  },
});

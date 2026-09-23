import { readFile } from 'node:fs/promises';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type UserConfig } from 'vite';

const monorepoRoot = path.resolve(__dirname, '../..');
const sampleDocument = path.join(monorepoRoot, 'examples/vite/public/sample.docx');
// The vendored Extend UI PDF viewer (shadcn registry item) imports through shadcn's `@/`
// alias; it resolves into the vendored tree only, never into first-party demo code.
const vendoredUi = path.join(__dirname, 'src/vendor/extend-ui');

/** Serve the canonical public sample without checking a second copy into the repository. */
function sampleDocumentPlugin(): Plugin {
  return {
    name: 'docx-to-pdf-sample-document',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/sample.docx') return next();
        void readFile(sampleDocument)
          .then((bytes) => {
            response.setHeader(
              'Content-Type',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            );
            response.end(bytes);
          })
          .catch(next);
      });
    },
    async generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'sample.docx',
        source: await readFile(sampleDocument),
      });
    },
  };
}

export default defineConfig(
  (): UserConfig => ({
    // The combined demo deployment serves this app under `/docx-to-pdf/`, the same way it
    // serves the Markdown demo; `bun run dev:pdf` keeps the root.
    base: process.env.VITE_BASE_PATH ?? '/',
    // Tailwind v4 serves only the vendored viewer: `src/pdf-viewer.css` scopes its preflight and
    // scans just `src/vendor/`, so the demo's own chrome keeps its plain CSS.
    plugins: [react(), tailwindcss(), sampleDocumentPlugin()],
    root: __dirname,
    resolve: {
      // Build the browser bundle from workspace sources so the preview build needs no
      // package `dist/`. The conversion itself never runs in the browser; the page posts
      // the document to `/api/convert`.
      alias: [
        { find: /^@\//, replacement: `${vendoredUi}/` },
        {
          find: /^@docx-editor\.dev\/react$/,
          replacement: path.join(monorepoRoot, 'packages/react/src/index.ts'),
        },
        {
          find: /^@docx-editor\.dev\/core$/,
          replacement: path.join(monorepoRoot, 'packages/core/src/index.ts'),
        },
        {
          find: '@docx-editor.dev/core/collaboration/replication',
          replacement: path.join(monorepoRoot, 'packages/core/src/collaboration/replication.ts'),
        },
        {
          find: /^@docx-editor\.dev\/core\/(binding|collaboration|editor|export|layout|output|store|sync)$/,
          replacement: path.join(monorepoRoot, 'packages/core/src/$1/index.ts'),
        },
        {
          find: /^@docx-editor\.dev\/core\/contracts\/(.+)$/,
          replacement: path.join(monorepoRoot, 'packages/core/src/contracts/$1.ts'),
        },
        {
          find: '@docx-editor.dev/fonts/google',
          replacement: path.join(monorepoRoot, 'packages/fonts/src/google-fonts.ts'),
        },
        {
          find: /^@docx-editor\.dev\/fonts$/,
          replacement: path.join(monorepoRoot, 'packages/fonts/src/index.ts'),
        },
        {
          find: /^@docx-editor\.dev\/i18n$/,
          replacement: path.join(monorepoRoot, 'packages/i18n/src/index.ts'),
        },
      ],
    },
    css: { postcss: { plugins: [] } },
    build: { outDir: 'dist' },
  })
);

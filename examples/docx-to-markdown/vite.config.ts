import { readFile } from 'node:fs/promises';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';
import { defineConfig, type Plugin, type UserConfig } from 'vite';
import { stripUnexpandedTailwind } from '../shared/strip-unexpanded-tailwind';

const monorepoRoot = path.resolve(__dirname, '../..');
const sampleDocument = path.join(monorepoRoot, 'examples/vite/public/sample.docx');

/** Serve the canonical public sample without checking a second copy into the repository. */
function sampleDocumentPlugin(): Plugin {
  return {
    name: 'docx-to-markdown-sample-document',
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
    base: process.env.VITE_BASE_PATH ?? '/',
    plugins: [react(), sampleDocumentPlugin()],
    root: __dirname,
    resolve: {
      alias: [
        {
          find: /^@docx-editor\.dev\/docx-to-markdown$/,
          replacement: path.join(monorepoRoot, 'packages/docx-to-markdown/src/index.ts'),
        },
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
          find: '@docx-editor.dev/pro/react',
          replacement: path.join(monorepoRoot, 'packages/pro/src/react/index.ts'),
        },
        {
          find: /^@docx-editor\.dev\/pro$/,
          replacement: path.join(monorepoRoot, 'packages/pro/src/index.ts'),
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
    css: {
      postcss: {
        plugins: [
          tailwindcss({ config: path.join(monorepoRoot, 'tailwind.config.js') }),
          autoprefixer(),
          stripUnexpandedTailwind,
        ] as UserConfig['css'] extends { postcss?: { plugins?: infer P } } ? P : never,
      },
    },
    server: {
      port: 5177,
      strictPort: true,
      open: false,
    },
    build: {
      outDir: 'dist',
    },
  })
);

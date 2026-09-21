import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type UserConfig } from 'vite';

const monorepoRoot = path.resolve(__dirname, '../..');

export default defineConfig(
  (): UserConfig => ({
    // The combined demo deployment serves this app under `/docx-to-pdf/`, the same way it
    // serves the Markdown demo; `bun run dev:pdf` keeps the root.
    base: process.env.VITE_BASE_PATH ?? '/',
    plugins: [react()],
    root: __dirname,
    resolve: {
      // Build the browser bundle from workspace sources so the preview build needs no
      // package `dist/`. The conversion itself never runs in the browser; the page posts
      // the document to `/api/convert`.
      alias: [
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

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'path';

const monorepoRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react()],
  root: __dirname,
  resolve: {
    // Workspace source aliases, so editing the library repaints the demo.
    // Ordered most-specific first.
    alias: [
      {
        find: '@docx-editor.dev/pro/react',
        replacement: path.join(monorepoRoot, 'packages/pro/src/react/index.ts'),
      },
      {
        find: '@docx-editor.dev/pro',
        replacement: path.join(monorepoRoot, 'packages/pro/src/index.ts'),
      },
      {
        find: '@docx-editor.dev/react',
        replacement: path.join(monorepoRoot, 'packages/react/src/index.ts'),
      },
      // The STYLESHEET, before any prefix rule that would swallow it. A plain-string
      // `@docx-editor.dev/core` alias matches by prefix, so `.../core/styles/editor.css`
      // resolved to `packages/core/src/index.ts/styles/editor.css` — a path through a file,
      // which is what "Not a directory" meant.
      {
        find: '@docx-editor.dev/core/styles/editor.css',
        replacement: path.join(monorepoRoot, 'packages/core/src/styles/editor.css'),
      },
      {
        find: '@docx-editor.dev/core/editor',
        replacement: path.join(monorepoRoot, 'packages/core/src/editor/index.ts'),
      },
      {
        find: /^@docx-editor\.dev\/core\/(binding|layout|output|store|automation)$/,
        replacement: path.join(monorepoRoot, 'packages/core/src/$1/index.ts'),
      },
      {
        find: /^@docx-editor\.dev\/core\/contracts\/(.+)$/,
        replacement: path.join(monorepoRoot, 'packages/core/src/contracts/$1.ts'),
      },
      {
        // EXACT. As a bare string this matched every `@docx-editor.dev/core/*` subpath too.
        find: /^@docx-editor\.dev\/core$/,
        replacement: path.join(monorepoRoot, 'packages/core/src/index.ts'),
      },
      {
        find: '@docx-editor.dev/i18n',
        replacement: path.join(monorepoRoot, 'packages/i18n/src/index.ts'),
      },
    ],
  },
  // The library's chrome is Tailwind scoped to `.ep-root`, so a host embedding it
  // must run the same layer or half the packaged controls render unstyled.
  css: {
    postcss: {
      plugins: [
        tailwindcss({ config: path.join(monorepoRoot, 'tailwind.config.js') }),
        autoprefixer(),
      ],
    },
  },
  server: { port: 5179 },
});

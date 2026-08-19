import { defineConfig, type Plugin } from 'vite';
import { readFile } from 'node:fs/promises';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'path';

const monorepoRoot = path.resolve(__dirname, '../..');

function canonicalFixturePlugin(): Plugin {
  const fixtures = new Map([
    ['/sample.docx', path.join(monorepoRoot, 'examples/vite/public/sample.docx')],
    [
      '/comprehensive-word-element-test.docx',
      path.join(monorepoRoot, 'e2e/fixtures/comprehensive-word-element-test.docx'),
    ],
    [
      '/harfbuzz-text-fidelity.docx',
      path.join(monorepoRoot, 'e2e/fixtures/harfbuzz-text-fidelity.docx'),
    ],
  ]);
  return {
    name: 'docx-editor-canonical-fixture',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ? req.url.split('?')[0]! : '';
        const devFixture =
          fixtures.get(url) ??
          (/^\/[\w.-]+\.docx$/.test(url)
            ? path.join(monorepoRoot, 'e2e/fixtures', path.basename(url))
            : undefined);
        const source = devFixture;
        if (!source) return next();
        readFile(source)
          .then((bytes) => {
            res.setHeader(
              'Content-Type',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            );
            res.end(bytes);
          })
          .catch(() => next());
      });
    },
    async generateBundle() {
      for (const [url, source] of fixtures) {
        this.emitFile({
          type: 'asset',
          fileName: url.slice(1),
          source: await readFile(source),
        });
      }
    },
  };
}

const usePublished = process.env.USE_PUBLISHED_PACKAGES === 'true';

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [vue(), vueJsx(), canonicalFixturePlugin()],
  define: {
    __ENABLE_FRAMEWORK_SWITCHER__: JSON.stringify(process.env.ENABLE_FRAMEWORK_SWITCHER === 'true'),
  },
  root: __dirname,
  resolve: {
    alias: usePublished
      ? [
          {
            find: /^@docx-editor\.dev\/vue$/,
            replacement: path.join(monorepoRoot, 'packages/vue/dist/index.js'),
          },
          {
            find: '@docx-editor.dev/pro/vue',
            replacement: path.join(monorepoRoot, 'packages/pro/dist/vue/index.js'),
          },
        ]
      : [
          {
            find: '@docx-editor.dev/vue/styles.css',
            replacement: path.join(monorepoRoot, 'packages/vue/src/styles/editor.css'),
          },
          {
            find: /^@docx-editor\.dev\/vue$/,
            replacement: path.join(monorepoRoot, 'packages/vue/src/index.ts'),
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
            find: '@docx-editor.dev/pro/vue',
            replacement: path.join(monorepoRoot, 'packages/pro/src/vue/index.ts'),
          },
          {
            find: '@docx-editor.dev/pro',
            replacement: path.join(monorepoRoot, 'packages/pro/src/index.ts'),
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
      ],
    },
  },
  server: {
    port: 5174,
    open: false,
  },
  build: {
    outDir: 'dist',
  },
});

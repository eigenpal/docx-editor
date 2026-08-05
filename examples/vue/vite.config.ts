import { defineConfig, type Plugin } from 'vite';
import { readFile } from 'node:fs/promises';
import vue from '@vitejs/plugin-vue';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'path';

const monorepoRoot = path.resolve(__dirname, '../..');

function fidelityFixturePlugin(): Plugin {
  const url = '/harfbuzz-text-fidelity.docx';
  const source = path.join(monorepoRoot, 'e2e/fixtures/harfbuzz-text-fidelity.docx');
  return {
    name: 'docx-editor-fidelity-fixture',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || req.url.split('?')[0] !== url) return next();
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
      this.emitFile({ type: 'asset', fileName: url.slice(1), source: await readFile(source) });
    },
  };
}

// USE_PUBLISHED_PACKAGES=true is set by the parity build; in that mode we
// resolve `@docx-editor.dev/vue` through node_modules
// (the workspace's published dist/) so the deployment shows the real
// consumer experience.
//
// `@docx-editor.dev/core` lives in a separate repo and is installed from npm,
// so it resolves through node_modules in both modes.
const usePublished = process.env.USE_PUBLISHED_PACKAGES === 'true';

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [vue(), fidelityFixturePlugin()],
  define: {
    // Matches the React examples — the parity build sets this to true so
    // the framework-switcher pills render alongside the chevron source
    // menu. Regular previews keep the title bar minimal.
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
        ]
      : [
          // Resolve the CSS subpath to source in dev so a clean checkout can
          // run the Vue demo and parity smoke tests without prebuilding dist.
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
            find: '@docx-editor.dev/i18n',
            replacement: path.join(monorepoRoot, 'packages/i18n/src/index.ts'),
          },
        ],
  },
  css: {
    // Dev mode aliases the adapter (and its styles.css) to source, so the
    // '@tailwind utilities' directive in packages/vue/src/styles/editor.css
    // must be expanded here. Point at the Vue package's own tailwind config
    // (scans packages/vue/src) so the demo shows real toolbar/dialog styles
    // without a prebuild — mirrors examples/vite's React setup. The published
    // parity build (USE_PUBLISHED_PACKAGES) instead loads the prebuilt
    // dist/docx-editor-vue.css, which already carries these utilities.
    postcss: {
      plugins: [
        tailwindcss({ config: path.join(monorepoRoot, 'packages/vue/tailwind.config.js') }),
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

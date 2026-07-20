import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'path';

const monorepoRoot = path.resolve(__dirname, '../..');

// USE_PUBLISHED_PACKAGES=true is set by the parity build; in that mode we
// resolve `@docx-editor.dev/vue` + `/agents/*` through node_modules
// (the workspace's published dist/) so the deployment shows the real
// consumer experience.
//
// `@docx-editor.dev/core` lives in a separate repo and is installed from npm,
// so it resolves through node_modules in both modes.
const usePublished = process.env.USE_PUBLISHED_PACKAGES === 'true';

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [vue()],
  define: {
    // Matches the React examples — the parity build sets this to true so
    // the framework-switcher pills render alongside the chevron source
    // menu. Regular previews keep the title bar minimal.
    __ENABLE_FRAMEWORK_SWITCHER__: JSON.stringify(process.env.ENABLE_FRAMEWORK_SWITCHER === 'true'),
  },
  root: __dirname,
  resolve: {
    alias: usePublished
      ? []
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
            find: '@docx-editor.dev/i18n',
            replacement: path.join(monorepoRoot, 'packages/i18n/src/index.ts'),
          },
          {
            find: '@docx-editor.dev/agents/vue',
            replacement: path.join(monorepoRoot, 'packages/agents/src/vue.ts'),
          },
          {
            find: '@docx-editor.dev/agents/bridge',
            replacement: path.join(monorepoRoot, 'packages/agents/src/bridge.ts'),
          },
          // Bare @docx-editor.dev/agents (e.g. for type re-exports)
          {
            find: /^@docx-editor\.dev\/agents$/,
            replacement: path.join(monorepoRoot, 'packages/agents/src/index.ts'),
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

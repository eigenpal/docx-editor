import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

// Library build for @eigenpal/docx-editor-vue. Vite (not tsup) because the
// package ships .vue SFCs that need the @vitejs/plugin-vue compiler step.
// External: vue, prosemirror-*, and the editor core — consumers bring those.
export default defineConfig({
  plugins: [
    vue(),
    // Exclude __tests__ + *.test-d.ts so type-level conformance tests don't
    // leak into the published tarball (dist/ → npm). Reviewer caught this
    // on PR #359.
    dts({
      include: ['src/**/*'],
      exclude: ['src/**/__tests__/**', 'src/**/*.test-d.ts'],
      // Pin the entry root so multi-entry builds still flatten declarations
      // to dist/index.d.ts + dist/ui.d.ts (auto-detect drifts to a parent
      // dir once core's workspace types enter the graph).
      entryRoot: 'src',
    }),
  ],
  build: {
    lib: {
      // Keep public subpaths backed by real JS chunks so consumers can import
      // composables/plugin APIs without dragging in the full editor shell.
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        ui: resolve(__dirname, 'src/ui.ts'),
        composables: resolve(__dirname, 'src/composables/index.ts'),
        dialogs: resolve(__dirname, 'src/components/dialogs/index.ts'),
        'plugin-api': resolve(__dirname, 'src/plugin-api/index.ts'),
        styles: resolve(__dirname, 'src/styles/index.ts'),
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
      cssFileName: 'docx-editor-vue',
    },
    rollupOptions: {
      external: ['vue', /^@eigenpal\/docx-editor-core(\/.*)?$/, /^prosemirror-/],
    },
    emptyOutDir: true,
  },
});

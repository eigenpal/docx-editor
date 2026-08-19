import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';
import { existsSync } from 'node:fs';

// Library build for @docx-editor.dev/vue. The adapter is a thin renderer over
// the private, declaration-only editor contract, which is bundled so the
// published tarball carries no reference to a private path. vue is external —
// consumers bring it.
export default defineConfig({
  resolve: {
    alias: [
      {
        // Core lanes are a mix of flat files (`contracts/editor.ts`) and directory
        // entries (`editor/index.ts`, `layout/index.ts`, ...). Mapping every subpath to
        // `$1.ts` broke the library build the moment a lane became a directory, so the
        // resolver tries the flat file first and falls back to the directory index.
        find: /^@docx-editor\.dev\/core\/(.+)$/,
        replacement: `${resolve(__dirname, '../core/src')}/$1`,
        customResolver(source: string) {
          return existsSync(`${source}.ts`) ? `${source}.ts` : resolve(source, 'index.ts');
        },
      },
      {
        find: '@docx-editor.dev/core',
        replacement: resolve(__dirname, '../core/src/index.ts'),
      },
    ],
  },
  plugins: [
    vue(),
    dts({
      include: ['src/**/*'],
      exclude: ['src/**/__tests__/**', 'src/**/*.test-d.ts'],
      entryRoot: 'src',
      pathsToAliases: false,
      compilerOptions: { declarationMap: false, stripInternal: true },
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
      cssFileName: 'docx-editor-vue',
    },
    rollupOptions: {
      external: (id) => id === 'vue' || id === 'emf-converter',
    },
    emptyOutDir: true,
  },
});

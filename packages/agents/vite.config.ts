import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

// Vite library build for the Vue + AI-SDK-Vue subpaths. Tsup runs first (clean
// + main entries); we extend its output with `dist/vue.{mjs,js,d.ts}` and
// `dist/ai-sdk/vue.{mjs,js,d.ts}` here, and `emptyOutDir: false` keeps tsup's
// files intact. Vite is needed because tsup/esbuild can't compile `.vue` SFCs.
export default defineConfig({
  plugins: [
    vue(),
    dts({
      include: ['src/vue.ts', 'src/vue/**/*', 'src/ai-sdk/vue.ts'],
      outDirs: ['dist'],
      processor: 'vue',
      // Single entry per d.ts file — api-extractor's bundleTypes is built
      // for single-entry libs and gets confused with our two entries.
      // Multiple .d.ts files per entry directory works fine for ESM
      // consumers and matches how tsup emits dist/*.d.ts above.
      entryRoot: 'src',
      cleanVueFileName: true,
      // Don't ship `.d.ts.map`. Maps point at source `.ts` files that
      // aren't in the published tarball, so they're dead weight.
      compilerOptions: { declarationMap: false },
    }),
  ],
  build: {
    lib: {
      entry: {
        vue: resolve(__dirname, 'src/vue.ts'),
        'ai-sdk/vue': resolve(__dirname, 'src/ai-sdk/vue.ts'),
      },
      formats: ['es', 'cjs'],
      fileName: (format, name) => `${name}.${format === 'es' ? 'mjs' : 'js'}`,
    },
    rollupOptions: {
      external: [
        'vue',
        '@ai-sdk/vue',
        'ai',
        /^@eigenpal\/docx-editor-core(\/.*)?$/,
        /^prosemirror-/,
      ],
    },
    emptyOutDir: false,
    minify: true,
    sourcemap: false,
  },
});

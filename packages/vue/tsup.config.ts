import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  platform: 'browser',
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  treeshake: true,
  minify: true,
  metafile: true,
  external: ['vue', '@docx-editor.dev/core', '@docx-editor.dev/i18n'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
    options.jsxImportSource = 'vue';
  },
});

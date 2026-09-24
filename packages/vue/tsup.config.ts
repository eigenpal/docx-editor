import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  platform: 'browser',
  format: ['cjs', 'esm'],
  // Declarations read sibling packages from their built `dist/`, which `build:packages`
  // builds first. Compiling their sources again multiplied this step's memory.
  dts: { compilerOptions: { paths: {} } },
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

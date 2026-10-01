import { defineConfig } from 'tsup';
import { buildDeclarations } from '../../scripts/build-declarations.mjs';

const entry = {
  index: 'src/index.ts',
};

export default defineConfig({
  entry,
  platform: 'browser',
  format: ['cjs', 'esm'],
  // TypeScript 7 emits the declarations. See scripts/build-declarations.mjs.
  dts: false,
  onSuccess: () => buildDeclarations(import.meta.url, { entry }),
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

import { defineConfig } from 'tsup';
import { withDeclarations } from '../../scripts/build-declarations.mjs';

export default defineConfig(
  withDeclarations(import.meta.url, {
    entry: {
      index: 'src/index.ts',
    },
    platform: 'browser',
    format: ['cjs', 'esm'],
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
  })
);

import { defineConfig } from 'tsup';
import { declarationCompilerOptions } from '../../scripts/declaration-options.mjs';
export default defineConfig({
  entry: ['src/index.ts'],
  platform: 'node',
  format: ['esm', 'cjs'],
  // See scripts/declaration-options.mjs.
  dts: {
    banner: '/// <reference lib="dom" />',
    compilerOptions: declarationCompilerOptions(import.meta.url),
  },
  clean: true,
  metafile: true,
  external: [/^@docx-editor\.dev\//, 'pdf-lib', 'fontkit'],
});

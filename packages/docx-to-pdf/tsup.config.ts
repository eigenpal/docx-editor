import { defineConfig } from 'tsup';
import { buildDeclarations } from '../../scripts/build-declarations.mjs';
const entry = ['src/index.ts'];

export default defineConfig({
  entry,
  platform: 'node',
  format: ['esm', 'cjs'],
  // TypeScript 7 emits the declarations. See scripts/build-declarations.mjs.
  dts: false,
  onSuccess: () =>
    buildDeclarations(import.meta.url, { entry, banner: '/// <reference lib="dom" />' }),
  clean: true,
  metafile: true,
  external: [/^@docx-editor\.dev\//, 'pdf-lib', 'fontkit'],
});

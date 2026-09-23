import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  platform: 'node',
  format: ['esm', 'cjs'],
  dts: { banner: '/// <reference lib="dom" />' },
  clean: true,
  metafile: true,
  external: [/^@docx-editor\.dev\//, 'pdf-lib', 'fontkit'],
});

import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  platform: 'node',
  format: ['esm', 'cjs'],
  // Declarations read sibling packages from their built `dist/`, which `build:packages`
  // builds first. Compiling their sources again multiplied this step's memory.
  dts: { banner: '/// <reference lib="dom" />', compilerOptions: { paths: {} } },
  clean: true,
  metafile: true,
  external: [/^@docx-editor\.dev\//, 'pdf-lib', 'fontkit'],
});

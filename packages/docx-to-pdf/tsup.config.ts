import { defineConfig } from 'tsup';
import { withDeclarations } from '../../scripts/build-declarations.mjs';
export default defineConfig(
  withDeclarations(import.meta.url, {
    entry: ['src/index.ts'],
    platform: 'node',
    format: ['esm', 'cjs'],
    declarations: {
      banner: '/// <reference lib="dom" />',
      // fontkit ships no types; this file declares the part the package uses.
      ambient: ['src/fontkit.d.ts'],
    },
    clean: true,
    metafile: true,
    external: [/^@docx-editor\.dev\//, 'pdf-lib', 'fontkit'],
  })
);

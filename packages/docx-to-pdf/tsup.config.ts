import { defineConfig } from 'tsup';
import { withDeclarations } from '../../scripts/build-declarations.mjs';
import { addLicenseHeaders } from '../../scripts/license-banner.mjs';
export default defineConfig(
  withDeclarations(import.meta.url, {
    // Every script in dist/ opens with the license header.
    onSuccess: addLicenseHeaders(import.meta.url),
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

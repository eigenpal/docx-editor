import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';
import { withDeclarations } from '../../scripts/build-declarations.mjs';
import { addLicenseHeaders } from '../../scripts/license-banner.mjs';
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string };
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
    // The PDF Producer names the release that wrote the file.
    define: { __DOCX_TO_PDF_VERSION__: JSON.stringify(version) },
    external: [/^@docx-editor\.dev\//, 'pdf-lib', 'fontkit'],
  })
);

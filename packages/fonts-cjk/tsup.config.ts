import { defineConfig } from 'tsup';
import { withDeclarations } from '../../scripts/build-declarations.mjs';

export default defineConfig(
  withDeclarations(import.meta.url, {
    // `browser` is ESM only: it finds the face through `import.meta.url`, which a CommonJS
    // build does not have. Its export map entry lists `import` alone.
    entry: { index: 'src/index.ts', browser: 'src/browser.ts' },
    format: ['esm', 'cjs'],
    clean: true,
    // The attribution generator reads `dist/metafile-*.json`. This package bundles no
    // third-party source (the face ships as an asset, under the OFL text in `licenses/`).
    metafile: true,
  })
);

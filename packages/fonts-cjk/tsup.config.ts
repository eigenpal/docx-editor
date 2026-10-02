import { defineConfig } from 'tsup';
import { withDeclarations } from '../../scripts/build-declarations.mjs';

export default defineConfig(
  withDeclarations(import.meta.url, {
    entry: ['src/index.ts'],
    platform: 'node',
    format: ['esm', 'cjs'],
    clean: true,
    // The attribution generator reads `dist/metafile-*.json`. This package bundles no
    // third-party source (the face ships as an asset, under the OFL text in `licenses/`).
    metafile: true,
  })
);

import { defineConfig } from 'tsup';
import { declarationCompilerOptions } from '../../scripts/declaration-options.mjs';

export default defineConfig({
  entry: ['src/index.ts'],
  platform: 'node',
  format: ['esm', 'cjs'],
  // See scripts/declaration-options.mjs.
  dts: { compilerOptions: declarationCompilerOptions(import.meta.url) },
  clean: true,
  // The attribution generator reads `dist/metafile-*.json`. This package bundles no
  // third-party source (the face ships as an asset, under the OFL text in `licenses/`).
  metafile: true,
});

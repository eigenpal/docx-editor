import { defineConfig } from 'tsup';
import { buildDeclarations } from '../../scripts/build-declarations.mjs';

const entry = ['src/index.ts'];

export default defineConfig({
  entry,
  platform: 'node',
  format: ['esm', 'cjs'],
  // TypeScript 7 emits the declarations. See scripts/build-declarations.mjs.
  dts: false,
  onSuccess: () => buildDeclarations(import.meta.url, { entry }),
  clean: true,
  // The attribution generator reads `dist/metafile-*.json`. This package bundles no
  // third-party source (the face ships as an asset, under the OFL text in `licenses/`).
  metafile: true,
});

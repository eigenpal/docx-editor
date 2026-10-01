import { defineConfig } from 'tsup';
import { buildDeclarations } from '../../scripts/build-declarations.mjs';

const entry = {
  index: 'src/index.ts',
  google: 'src/google-fonts.ts',
};

export default defineConfig({
  // One entry per published subpath. Keep in step with `exports` in package.json.
  entry,
  platform: 'browser',
  format: ['cjs', 'esm'],
  // TypeScript 7 emits the declarations. See scripts/build-declarations.mjs.
  dts: false,
  onSuccess: () => buildDeclarations(import.meta.url, { entry }),
  splitting: true,
  sourcemap: false,
  clean: true,
  treeshake: true,
  minify: true,
  // The attribution generator reads `dist/metafile-*.json`. This package bundles no
  // third-party source (the TTFs ship as assets, under the OFL texts in `licenses/`),
  // so the notice it emits says exactly that.
  metafile: true,
  // The font files themselves are shipped as-is through `files`, not bundled:
  // this package resolves them at runtime from its own directory.
});

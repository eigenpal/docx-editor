import { defineConfig } from 'tsup';

export default defineConfig({
  // One entry per published subpath. Keep in step with `exports` in package.json.
  entry: {
    index: 'src/index.ts',
    google: 'src/google-fonts.ts',
  },
  platform: 'browser',
  format: ['cjs', 'esm'],
  dts: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  treeshake: true,
  minify: true,
  // The font files themselves are shipped as-is through `files`, not bundled:
  // this package resolves them at runtime from its own directory.
});

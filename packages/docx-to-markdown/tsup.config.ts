import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  platform: 'node',
  format: ['cjs', 'esm'],
  dts: true,
  splitting: true,
  clean: true,
  treeshake: true,
  minify: true,
  metafile: true,
  // Core must remain a peer (one engine instance), and fonts must retain its packaged assets.
  external: [
    '@docx-editor.dev/core/export',
    '@docx-editor.dev/core/layout',
    '@docx-editor.dev/core/store',
    '@docx-editor.dev/fonts',
  ],
});

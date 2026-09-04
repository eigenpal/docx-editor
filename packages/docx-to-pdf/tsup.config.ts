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
  external: [/^@docx-editor\.dev\/core(?:\/|$)/, '@docx-editor.dev/fonts', 'pdfkit'],
});

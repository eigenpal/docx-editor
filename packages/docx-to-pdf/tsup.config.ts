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
  // Keep pdfkit and fontkit out of the bundle so notices stay empty of their
  // MIT text and consumers resolve one copy through the package manager.
  external: [/^@docx-editor\.dev\/core(?:\/|$)/, '@docx-editor.dev/fonts', 'pdfkit', 'fontkit'],
});

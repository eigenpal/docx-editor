import { defineConfig } from 'tsup';
import { buildDeclarations } from '../../scripts/build-declarations.mjs';

const entry = { index: 'src/index.ts', node: 'src/node.ts' };

export default defineConfig({
  entry,
  platform: 'node',
  format: ['cjs', 'esm'],
  // Advanced live-view types share browser contracts with Core. Declare that type-only
  // dependency here so Node consumers do not need to change lib or skipLibCheck.
  // This adds no DOM runtime dependency or polyfill.
  // TypeScript 7 emits the declarations. See scripts/build-declarations.mjs.
  dts: false,
  onSuccess: () =>
    buildDeclarations(import.meta.url, { entry, banner: '/// <reference lib="dom" />' }),
  splitting: true,
  clean: true,
  treeshake: true,
  minify: true,
  metafile: true,
  // Core must remain a peer (one engine instance), and fonts must retain its packaged assets.
  external: [/^@docx-editor\.dev\/core(?:\/|$)/, '@docx-editor.dev/fonts'],
});

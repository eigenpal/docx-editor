import { defineConfig } from 'tsup';
import { withDeclarations } from '../../scripts/build-declarations.mjs';

export default defineConfig(
  withDeclarations(import.meta.url, {
    entry: { index: 'src/index.ts', node: 'src/node.ts' },
    platform: 'node',
    format: ['cjs', 'esm'],
    // Advanced live-view types share browser contracts with Core. Declare that type-only
    // dependency here so Node consumers do not need to change lib or skipLibCheck.
    // This adds no DOM runtime dependency or polyfill.
    declarations: { banner: '/// <reference lib="dom" />' },
    splitting: true,
    clean: true,
    treeshake: true,
    minify: true,
    metafile: true,
    // Core must remain a peer (one engine instance), and fonts must retain its packaged assets.
    external: [/^@docx-editor\.dev\/core(?:\/|$)/, '@docx-editor.dev/fonts'],
  })
);

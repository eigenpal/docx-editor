import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    ui: 'src/ui.ts',
    dialogs: 'src/components/dialogs/index.ts',
    hooks: 'src/hooks/index.ts',
    'plugin-api': 'src/plugin-api/index.ts',
    styles: 'src/styles/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  treeshake: true,
  minify: true,
  // The rendering engine is intentionally not a public core subpath. Bundle
  // first-party adapter uses so published JS never imports those private paths.
  noExternal: [
    /^@eigenpal\/docx-editor-core\/(?:editor|flow-model|painter-model|pagination-model)(?:\/|$)/,
    '@eigenpal/docx-editor-core/utils/removeHeaderFooterForSection',
  ],
  external: [
    'react',
    'react-dom',
    'prosemirror-commands',
    'prosemirror-dropcursor',
    'prosemirror-history',
    'prosemirror-keymap',
    'prosemirror-model',
    'prosemirror-state',
    'prosemirror-tables',
    'prosemirror-transform',
    'prosemirror-view',
  ],
  injectStyle: false,
});

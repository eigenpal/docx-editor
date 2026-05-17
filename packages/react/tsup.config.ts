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

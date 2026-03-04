import { defineConfig } from 'tsup';

const isProd = process.env.NODE_ENV === 'production';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react.ts',
    ui: 'src/ui.ts',
    'core-reexport': 'src/core-reexport.ts',
    'headless-reexport': 'src/headless-reexport.ts',
    'core-plugins-reexport': 'src/core-plugins-reexport.ts',
    'mcp-reexport': 'src/mcp-reexport.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: true,
  sourcemap: !isProd,
  clean: true,
  treeshake: true,
  minify: true,
  external: [
    'react',
    'react-dom',
    '@eigenpal/docx-core',
    '@eigenpal/docx-core/headless',
    '@eigenpal/docx-core/core-plugins',
    '@eigenpal/docx-core/mcp',
    'prosemirror-commands',
    'prosemirror-dropcursor',
    'prosemirror-history',
    'prosemirror-keymap',
    'prosemirror-model',
    'prosemirror-state',
    'prosemirror-tables',
    'prosemirror-view',
  ],
  injectStyle: false,
});

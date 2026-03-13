import { defineConfig } from 'tsup';

const isProd = process.env.NODE_ENV === 'production';
const perfDefine = process.env.DOCX_PERF ?? (isProd ? 'false' : 'true');

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
  sourcemap: false,
  clean: true,
  treeshake: true,
  minify: true,
  define: {
    __DOCX_PERF__: perfDefine,
  },
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
    'prosemirror-view',
  ],
  esbuildOptions(options) {
    options.loader = {
      ...options.loader,
      '.aff': 'text',
      '.dic': 'text',
    };
  },
  injectStyle: false,
});

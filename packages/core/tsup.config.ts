import { defineConfig } from 'tsup';

const isProd = process.env.NODE_ENV === 'production';
const perfDefine = process.env.DOCX_PERF ?? (isProd ? 'false' : 'true');

export default defineConfig([
  {
    entry: {
      core: 'src/core.ts',
      headless: 'src/headless.ts',
      'core-plugins': 'src/core-plugins/index.ts',
      mcp: 'src/mcp/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    splitting: true,
    sourcemap: !isProd,
    clean: true,
    treeshake: true,
    minify: true,
    define: {
      __DOCX_PERF__: perfDefine,
    },
    external: [
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
  },
  // CLI build (with shebang) - bundles all deps for standalone use
  {
    entry: {
      'mcp-cli': 'src/mcp/cli.ts',
    },
    format: ['esm'],
    dts: true,
    splitting: false,
    sourcemap: !isProd,
    clean: false,
    treeshake: true,
    minify: true,
    define: {
      __DOCX_PERF__: perfDefine,
    },
    injectStyle: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);

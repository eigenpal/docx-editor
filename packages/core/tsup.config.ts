import { defineConfig } from 'tsup';

const isProd = process.env.NODE_ENV === 'production';

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
    external: [
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
    injectStyle: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);

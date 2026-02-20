import { defineConfig } from 'tsup';

const isProd = process.env.NODE_ENV === 'production';

export default defineConfig([
  // Main builds (without shebang)
  {
    entry: {
      index: 'src/index.ts',
      headless: 'src/headless.ts',
      core: 'src/core.ts',
      react: 'src/react.ts',
      ui: 'src/ui.ts',
      'core-plugins': 'src/core-plugins/index.ts',
      mcp: 'src/mcp/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    splitting: true, // Enable code splitting for tree-shaking
    sourcemap: !isProd, // Disable source maps in production to reduce package size
    clean: true,
    treeshake: true, // Enable tree-shaking
    minify: true, // Minify the output
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
    sourcemap: !isProd, // Disable source maps in production
    clean: false, // Don't clean since main build already did
    treeshake: true,
    minify: true,
    external: ['react', 'react-dom'],
    injectStyle: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);

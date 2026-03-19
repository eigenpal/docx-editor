import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    bridge: 'src/bridge.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  treeshake: {
    preset: 'smallest',
  },
  minify: true,
  noExternal: ['@eigenpal/docx-core'],
  external: ['prosemirror-model', 'prosemirror-state', 'prosemirror-view'],
});

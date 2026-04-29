import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    bridge: 'src/bridge.ts',
    server: 'src/server.ts',
    react: 'src/react.ts',
    mcp: 'src/mcp/index.ts',
    'ai-sdk/server': 'src/ai-sdk/server.ts',
    'ai-sdk/react': 'src/ai-sdk/react.ts',
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
  external: ['prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'react', 'ai'],
});

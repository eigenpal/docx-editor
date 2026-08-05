import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreSrc = path.resolve(here, '../core/src');

// Tsup builds the framework-agnostic + React entries. Vue SFCs are built by
// `vite.config.ts` because tsup/esbuild can't compile `.vue` files. The
// dedicated `tsconfig.tsup.json` excludes vue/* so the d.ts pass doesn't
// trip on the SFC shim.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    server: 'src/server.ts',
    react: 'src/react.ts',
    bridge: 'src/bridge.ts',
    mcp: 'src/mcp/index.ts',
    'ai-sdk/server': 'src/ai-sdk/server.ts',
    'ai-sdk/react': 'src/ai-sdk/react.ts',
  },
  format: ['cjs', 'esm'],
  dts: { resolve: true },
  tsconfig: 'tsconfig.tsup.json',
  splitting: true,
  sourcemap: false,
  clean: true,
  treeshake: {
    preset: 'smallest',
  },
  minify: true,
  noExternal: ['@docx-editor.dev/core'],
  external: ['prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'react', 'ai'],
  esbuildOptions(options) {
    options.alias = {
      ...(options.alias ?? {}),
      '@docx-editor.dev/core/headless': path.join(coreSrc, 'headless.ts'),
      '@docx-editor.dev/core/utils/paragraphFlashTypes': path.join(
        coreSrc,
        'utils/paragraphFlashTypes.ts'
      ),
      '@docx-editor.dev/core': path.join(coreSrc, 'core.ts'),
    };
  },
});

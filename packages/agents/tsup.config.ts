import { defineConfig } from 'tsup';

// Tsup builds the framework-agnostic + React entries. Vue SFCs are built by
// `vite.config.ts` because tsup/esbuild can't compile `.vue` files. The
// dedicated `tsconfig.tsup.json` excludes vue/* so the d.ts pass doesn't
// trip on the SFC shim.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    server: 'src/server.ts',
    // Two entries on purpose: `runtime` is neutral and `runtime/browser` is the one that reaches
    // the editor lane. See `src/runtime/index.ts`.
    runtime: 'src/runtime/index.ts',
    'runtime/browser': 'src/runtime/browser-entry.ts',
    react: 'src/react.ts',
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
  // `@docx-editor.dev/core-contract` is private and never published, so the runtime entry has to
  // carry it: left external, the shipped `dist/runtime.mjs` would import a package that does not
  // exist on npm. Same treatment `packages/react` gives it.
  noExternal: ['@docx-editor.dev/core', /^@docx-editor\.dev\/core-contract(?:\/|$)/],
  // `harfbuzzjs` stays external for the reason `packages/react` keeps it external: it initializes
  // its wasm with a top-level `await`, which cannot be bundled into a CJS output at all. It reaches
  // this build through the editor lane, so only the `runtime/browser` entry depends on it.
  external: [
    'prosemirror-model',
    'prosemirror-state',
    'prosemirror-view',
    'react',
    'ai',
    'harfbuzzjs',
  ],
});

import { defineConfig } from 'tsup';

// Two entries, one build. `index` is the server-safe one; `browser` is the one that reaches the
// editor lane. See `src/index.ts` for why that split exists.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    browser: 'src/browser.ts',
  },
  // The same reason `packages/react` sets it: tsup's default platform is `node`, which resolves
  // bundled dependencies through their `node` export condition, and fflate's node build runs
  // `createRequire("/")` at module top level — which throws on a page. fflate's browser build is
  // plain JavaScript and runs on a server, in a worker and in a page, so choosing it here is what
  // makes the ROOT entry importable from all three rather than only from Node.
  platform: 'browser',
  format: ['cjs', 'esm'],
  dts: { resolve: true },
  tsconfig: 'tsconfig.json',
  // Off on purpose. With splitting, "what is in the server bundle" becomes a question about a
  // graph of shared chunks; off, `scripts/pack-smoke.mjs` can answer it by reading one entry file.
  // Core remains an external dependency below: that is required for one engine copy in a browser.
  splitting: false,
  sourcemap: false,
  clean: true,
  treeshake: {
    preset: 'smallest',
  },
  minify: true,
  // Read by `scripts/generate-third-party-notices.mjs` — see the note in
  // `packages/react/tsup.config.ts`. The engine is external and declared, so what
  // esbuild inlined is the record of the third-party code this package
  // redistributes on its own account.
  metafile: true,
  // `@docx-editor.dev/core` stays external by tsup's workspace-package behavior. It is a published
  // package and a declared dependency, so the consumer resolves one copy of the engine. Inlining
  // it here would give a page running this alongside an adapter two engines.
  // `harfbuzzjs` is external to get the build to RESOLVE, not because the output needs it.
  //
  // The browser entry reaches the editor lane, whose layout pass loads the font shaper through
  // `await import('harfbuzzjs')`. esbuild resolves every specifier while building the graph, before
  // it drops anything — and the shaper's wasm wrapper needs Node's `module` and a top-level
  // `await`, so resolving it fails the CJS build outright. Externalizing skips the resolve.
  //
  // Nothing then mentions `harfbuzzjs`: `createBrowserAutomationHost` takes an editor the host
  // already created, so this package needs the host adapter and not the text-measurement pass.
  // `scripts/pack-smoke.mjs` allows only the declared core dependency to remain bare.
  external: ['harfbuzzjs'],
});

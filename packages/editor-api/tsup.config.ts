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
  // graph of shared chunks; off, `dist/index.mjs` is one self-contained file and
  // `scripts/pack-smoke.mjs` can answer it by reading that file. The editor lane is duplicated
  // into `dist/browser.mjs` as a result, and a consumer only ever loads one of the two.
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
  // `@docx-editor.dev/core` stays external. It is a published package and a declared
  // dependency, so the consumer resolves one copy of the engine. Inlining it here would
  // give a page running this alongside the adapter two engines.
  // `harfbuzzjs` is external to get the build to RESOLVE, not because the output needs it.
  //
  // The browser entry reaches the editor lane, whose layout pass loads the font shaper through
  // `await import('harfbuzzjs')`. esbuild resolves every specifier while building the graph, before
  // it drops anything — and the shaper's wasm wrapper needs Node's `module` and a top-level
  // `await`, so resolving it fails the CJS build outright. Externalizing skips the resolve.
  //
  // Nothing then survives into the emitted bundles: neither output mentions `harfbuzzjs`, because
  // the code path that would load it is unreachable from these entries — `createBrowserAutomationHost`
  // takes an editor the host already created, so this package needs the host adapter and not the
  // pass that measures text. That is why the package declares no runtime dependency, and why
  // `scripts/pack-smoke.mjs` asserts ZERO bare imports in the tarball's bundles rather than
  // trusting this list: an external import that did survive would be one a consumer cannot resolve.
  external: ['harfbuzzjs'],
});

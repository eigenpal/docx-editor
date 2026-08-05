import { defineConfig } from 'tsup';

export default defineConfig({
  // One entry per published subpath: the framework-neutral surface and the
  // React chrome. Keep in step with `exports` in package.json.
  entry: {
    index: 'src/index.ts',
    'react/index': 'src/react/index.ts',
  },
  // Same reason the engine and the adapter set it: tsup defaults to `node`,
  // which resolves bundled deps through their `node` export condition.
  platform: 'browser',
  format: ['cjs', 'esm'],
  dts: true,
  splitting: true,
  sourcemap: false,
  clean: true,
  treeshake: true,
  minify: true,
  // The attribution generator reads `dist/metafile-*.json` to learn what esbuild inlined.
  // Today that is nothing (see below), and the emitted notice says so — but it is the
  // build, not a comment, that decides, so a later `noExternal` cannot ship a bundled
  // dependency with no license text.
  metafile: true,
  // tsup externalizes `dependencies` and `peerDependencies`, so the engine, the
  // string catalogue and the adapter stay external and resolve to the copies the
  // consumer already installed. Nothing here is bundled: a second copy of the
  // engine inside this package would give the module two editor instances.
});

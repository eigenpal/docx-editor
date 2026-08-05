import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  // The adapter runs in the browser. tsup's default platform is `node`, which
  // resolves bundled deps through their `node` export condition — fflate then
  // brings its worker_threads loader, whose `createRequire("/")` runs at module
  // top level and throws in a browser (`createRequire is not a function`), so
  // the demo died before first paint. `browser` picks fflate's browser build,
  // exactly what the Vite-built vue adapter already ships; the CJS output stays
  // SSR-safe because fflate touches Worker/Blob only inside its async APIs,
  // which the editor never calls.
  //
  // fflate reaches this bundle transitively, through the contract package below.
  // It is listed in this package's devDependencies only because the tests build
  // DOCX fixtures with it; tsup externalizes `dependencies`/`peerDependencies`
  // and bundles everything else, so moving that entry into `dependencies` would
  // silently externalize fflate and change the published output. Leave it where
  // it is.
  platform: 'browser',
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  treeshake: true,
  minify: true,
  // The editor contract is a private, declaration-only package; bundle it so
  // published JS carries no reference to a private path.
  noExternal: [/^@docx-editor\.dev\/core-contract(?:\/|$)/],
  // rtf.js is deep-imported (`rtf.js/dist/EMFJS.bundle.js`) and lazily loaded; the
  // subpath pattern keeps the metafile renderer out of the main bundle.
  external: ['react', 'react-dom', 'harfbuzzjs', 'rtf.js', /^rtf\.js\//],
});

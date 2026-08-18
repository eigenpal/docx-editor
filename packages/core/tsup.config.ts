import { copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Options } from 'tsup';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Put HarfBuzz's `.wasm` beside the bundle that now contains its loader.
 *
 * The loader finds its binary with `new URL('harfbuzz.wasm', import.meta.url)`. Inlining the
 * loader into the ESM bundle moves that URL from harfbuzzjs's own directory to this
 * package's `dist/`, so the file has to be there — for Node, which reads it off disk, and
 * for every consumer bundler, which rewrites that expression into an emitted asset only if
 * the target exists at build time. Resolved through harfbuzzjs's export map rather than a
 * hand-written node_modules path, so a hoisted or linked install finds it the same way.
 */
async function copyHarfBuzzBinary(): Promise<void> {
  const entry = fileURLToPath(import.meta.resolve('harfbuzzjs'));
  await copyFile(resolve(dirname(entry), 'harfbuzz.wasm'), resolve(here, 'dist/harfbuzz.wasm'));
}

/**
 * Everything the two format builds agree on.
 *
 * They are separate builds for ONE reason, spelled out at `esm` below: the ESM bundle
 * inlines harfbuzzjs and the CJS bundle cannot.
 */
const shared = {
  // One entry per published subpath. Keep this in step with `exports` in
  // package.json: a subpath with no entry here resolves to a missing file.
  entry: {
    index: 'src/index.ts',
    automation: 'src/automation/index.ts',
    binding: 'src/binding/index.ts',
    'contracts/editor': 'src/contracts/editor.ts',
    'contracts/document': 'src/contracts/document.ts',
    'contracts/interaction': 'src/contracts/interaction.ts',
    'contracts/modules': 'src/contracts/modules.ts',
    'contracts/types': 'src/contracts/types-barrel.ts',
    layout: 'src/layout/index.ts',
    output: 'src/output/index.ts',
    store: 'src/store/index.ts',
    editor: 'src/editor/index.ts',
  },
  // Same reason the adapter sets it: tsup defaults to `node`, which resolves
  // bundled deps through their `node` export condition, and fflate's node build
  // runs `createRequire` at module top level and throws in a browser.
  platform: 'browser',
  dts: true,
  // Many entries share the engine's internals. Splitting emits them once into
  // shared chunks instead of copying them into all fourteen bundles.
  splitting: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  // `scripts/generate-third-party-notices.mjs` reads `dist/metafile-*.json` to learn
  // which third-party packages esbuild actually inlined into the shipped bundles, and
  // emits the attribution file for exactly those. This package is the one that inlines
  // the most of them: fast-xml-parser, fflate and the prosemirror-* family all end up as
  // source inside `dist/`.
  metafile: true,
  external: ['emf-converter', 'utif2'],
  // The engine's own files import it by package name ('@docx-editor.dev/core/store'
  // and friends), which resolved through the export map back when that map pointed
  // at src. Now that it points at dist, the build has to be told where source is,
  // or it chases a dist that does not exist yet.
  //
  // tsconfig.json carries the same table as `paths`, for the declaration pass and
  // for every consumer that compiles core's sources. It has no comment saying so
  // because core-lane-graph.test.ts reads that file with a plain JSON.parse.
  esbuildOptions(options) {
    options.alias = {
      // See `src/layout/node-module-shim.ts`: the inlined HarfBuzz runtime asks for Node's
      // `module` behind a guard no browser runs, and this is what it gets instead. Harmless
      // in the CJS build, which inlines nothing that asks for it.
      module: resolve(here, 'src/layout/node-module-shim.ts'),
      '@docx-editor.dev/core': resolve(here, 'src/index.ts'),
      '@docx-editor.dev/core/automation': resolve(here, 'src/automation/index.ts'),
      '@docx-editor.dev/core/binding': resolve(here, 'src/binding/index.ts'),
      '@docx-editor.dev/core/contracts/editor': resolve(here, 'src/contracts/editor.ts'),
      '@docx-editor.dev/core/contracts/document': resolve(here, 'src/contracts/document.ts'),
      '@docx-editor.dev/core/contracts/interaction': resolve(here, 'src/contracts/interaction.ts'),
      '@docx-editor.dev/core/contracts/modules': resolve(here, 'src/contracts/modules.ts'),
      '@docx-editor.dev/core/contracts/types': resolve(here, 'src/contracts/types-barrel.ts'),
      '@docx-editor.dev/core/layout': resolve(here, 'src/layout/index.ts'),
      '@docx-editor.dev/core/output': resolve(here, 'src/output/index.ts'),
      '@docx-editor.dev/core/store': resolve(here, 'src/store/index.ts'),
      '@docx-editor.dev/core/editor': resolve(here, 'src/editor/index.ts'),
    };
  },
} satisfies Options;

export default defineConfig([
  {
    ...shared,
    format: ['esm'],
    // First in the array, so this is the build that empties `dist/`.
    clean: true,
    onSuccess: copyHarfBuzzBinary,
    // THE POINT OF THE SPLIT. Left external, harfbuzzjs reaches the consumer's bundler with
    // an `await import("module")` that no browser target can resolve, and every host has to
    // answer for it in its own config (#282). Inlined, the `module` alias above answers it
    // once, here. `external` alone would not do it: tsup externalizes every `dependencies`
    // entry by default, so it has to be named here to be pulled in.
    //
    // This also makes harfbuzzjs the one dependency esbuild inlines, so it is the one whose
    // licence `notices:generate` must reproduce — which it does, from the metafile, on its
    // own.
    noExternal: ['harfbuzzjs'],
  },
  {
    ...shared,
    format: ['cjs'],
    // Runs second, over the ESM build's output.
    clean: false,
    // harfbuzzjs stays EXTERNAL here, because it cannot be inlined: its entry is a
    // top-level `await` over the WASM instantiation, and CJS has no top-level await. That
    // costs nothing. This output exists for `require()`, which is Node, where `module`
    // resolves natively and #282 cannot happen. Browser bundlers take the `import`
    // condition and get the bundle above.
  },
]);

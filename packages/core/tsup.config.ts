import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
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
  format: ['cjs', 'esm'],
  dts: true,
  // Many entries share the engine's internals. Splitting emits them once into
  // shared chunks instead of copying them into all fourteen bundles.
  splitting: true,
  sourcemap: false,
  clean: true,
  treeshake: true,
  minify: true,
  // `scripts/generate-third-party-notices.mjs` reads `dist/metafile-*.json` to learn
  // which third-party packages esbuild actually inlined into the shipped bundles, and
  // emits the attribution file for exactly those. This package is the one that inlines
  // the most of them: fast-xml-parser, fflate and the prosemirror-* family all end up as
  // source inside `dist/`.
  metafile: true,
  external: ['harfbuzzjs', 'emf-converter'],
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
});

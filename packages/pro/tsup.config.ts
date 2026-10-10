import { defineConfig } from 'tsup';
import { withDeclarations } from '../../scripts/build-declarations.mjs';

const shared = {
  platform: 'browser' as const,
  format: ['cjs', 'esm'] as ('cjs' | 'esm')[],
  splitting: true,
  sourcemap: false,
  // The package `build` script empties `dist/` before tsup starts.
  clean: false,
  treeshake: true,
  minify: true,
  external: [
    '@docx-editor.dev/core',
    '@docx-editor.dev/core/collaboration',
    '@docx-editor.dev/core/store',
    '@docx-editor.dev/i18n',
    '@docx-editor.dev/react',
    '@docx-editor.dev/vue',
    'react',
    'react-dom',
    'vue',
    'yjs',
    'y-protocols',
    'y-protocols/awareness',
    'y-webrtc',
    '@hocuspocus/provider',
  ],
};

const REACT_ENTRIES = {
  index: 'src/index.ts',
  'react/index': 'src/react/index.ts',
  'react/webrtc': 'src/react/webrtc.ts',
  'react/hocuspocus': 'src/react/hocuspocus.ts',
  'collaboration/index': 'src/collaboration/index.ts',
  'collaboration/webrtc': 'src/collaboration/webrtc.ts',
  'collaboration/hocuspocus': 'src/collaboration/hocuspocus.ts',
};

const VUE_ENTRIES = {
  'vue/index': 'src/vue/index.ts',
  'vue/webrtc': 'src/vue/webrtc.ts',
  'vue/hocuspocus': 'src/vue/hocuspocus.ts',
};

// One build for every entry, so the entries share one copy of each module: the
// collaboration engine, which the React and Vue entries both reach, ships once per format.
// React's JSX runtime is the default; each Vue `.tsx` file names Vue's with a
// `@jsxImportSource` pragma, which esbuild reads per file. TypeScript cannot switch JSX
// modes per file, so the declarations come from two programs.
export default defineConfig(
  withDeclarations(import.meta.url, {
    ...shared,
    entry: { ...REACT_ENTRIES, ...VUE_ENTRIES },
    metafile: true,
    esbuildOptions(options) {
      options.jsx = 'automatic';
    },
    declarations: [
      { entry: REACT_ENTRIES },
      { entry: VUE_ENTRIES, compilerOptions: { jsx: 'preserve', jsxImportSource: 'vue' } },
    ],
  })
);

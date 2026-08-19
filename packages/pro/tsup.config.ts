import { defineConfig } from 'tsup';

const shared = {
  platform: 'browser' as const,
  format: ['cjs', 'esm'] as ('cjs' | 'esm')[],
  splitting: true,
  sourcemap: false,
  clean: false,
  treeshake: true,
  minify: true,
  metafile: true,
  external: [
    '@docx-editor.dev/core',
    '@docx-editor.dev/i18n',
    '@docx-editor.dev/react',
    '@docx-editor.dev/vue',
    'react',
    'react-dom',
    'vue',
  ],
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: 'src/index.ts',
      'react/index': 'src/react/index.ts',
    },
    dts: true,
    clean: true,
  },
  {
    ...shared,
    clean: false,
    entry: {
      'vue/index': 'src/vue/index.ts',
    },
    dts: {
      resolve: true,
      compilerOptions: {
        jsx: 'preserve',
        jsxImportSource: 'vue',
      },
    },
    esbuildOptions(options) {
      options.jsx = 'automatic';
      options.jsxImportSource = 'vue';
    },
  },
]);

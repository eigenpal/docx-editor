import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: { resolve: true },
  splitting: false,
  sourcemap: false,
  clean: true,
  minify: false,
});

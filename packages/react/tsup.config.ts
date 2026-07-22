import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
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
  external: ['react', 'react-dom'],
});

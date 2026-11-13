import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  platform: 'browser',
  dts: true,
  clean: true,
  sourcemap: false,
  external: ['react', 'react/jsx-runtime', /^@docx-editor\.dev\//],
});

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    webrtc: 'src/webrtc.ts',
  },
  platform: 'browser',
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  clean: false,
  metafile: true,
  external: [
    '@docx-editor.dev/core',
    '@docx-editor.dev/core/collaboration',
    '@docx-editor.dev/core/store',
    'yjs',
    'y-protocols',
    'y-protocols/awareness',
    'y-webrtc',
  ],
});

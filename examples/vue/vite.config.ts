import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

const monorepoRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  plugins: [vue()],
  root: __dirname,
  resolve: {
    alias: {
      '@eigenpal/docx-editor-vue': path.join(monorepoRoot, 'packages/vue/src/index.ts'),
      '@eigenpal/docx-core': path.join(monorepoRoot, 'packages/core/src/core.ts'),
      '@eigenpal/docx-core/headless': path.join(monorepoRoot, 'packages/core/src/headless.ts'),
      '@eigenpal/docx-core/core-plugins': path.join(
        monorepoRoot,
        'packages/core/src/core-plugins/index.ts'
      ),
      '@eigenpal/docx-core/': path.join(monorepoRoot, 'packages/core/src/'),
    },
  },
  server: {
    port: 5174,
    open: false,
  },
  build: {
    outDir: 'dist',
  },
});

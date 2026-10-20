import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), vue()],
  optimizeDeps: { entries: ['index.html'] },
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: [
      { find: /^@docx-editor\.dev\/react$/, replacement: root + 'packages/react/dist/index.mjs' },
      { find: /^@docx-editor\.dev\/vue$/, replacement: root + 'packages/vue/dist/index.js' },
      {
        find: '@docx-editor.dev/react/styles.css',
        replacement: root + 'packages/react/src/styles/editor.css',
      },
      {
        find: '@docx-editor.dev/vue/styles.css',
        replacement: root + 'packages/vue/src/styles/editor.css',
      },
      {
        find: '@docx-editor.dev/core/styles/editor.css',
        replacement: root + 'packages/core/dist/editor.css',
      },
    ],
  },
});

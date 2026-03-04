import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'path';

const monorepoRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  resolve: {
    alias: {
      // Resolve package imports to source for live development
      '@eigenpal/docx-js-editor': path.join(monorepoRoot, 'packages/react/src/index.ts'),
      '@eigenpal/docx-core': path.join(monorepoRoot, 'packages/core/src/core.ts'),
      '@eigenpal/docx-core/headless': path.join(monorepoRoot, 'packages/core/src/headless.ts'),
      '@eigenpal/docx-core/core-plugins': path.join(
        monorepoRoot,
        'packages/core/src/core-plugins/index.ts'
      ),
      '@eigenpal/docx-core/mcp': path.join(monorepoRoot, 'packages/core/src/mcp/index.ts'),
      // Wildcard alias for deep core imports used by react package
      '@eigenpal/docx-core/': path.join(monorepoRoot, 'packages/core/src/'),
      '@': path.join(monorepoRoot, 'packages/react/src'),
    },
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss({ config: path.join(monorepoRoot, 'tailwind.config.js') }),
        autoprefixer(),
      ],
    },
  },
  define: {
    __ENABLE_FRAMEWORK_SWITCHER__: JSON.stringify(process.env.ENABLE_FRAMEWORK_SWITCHER === 'true'),
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    outDir: 'dist',
  },
});

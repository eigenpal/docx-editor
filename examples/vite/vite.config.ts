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
    alias: [
      // Resolve package imports to source for live development
      // Order matters: more-specific prefixes before less-specific ones
      {
        find: '@eigenpal/docx-js-editor',
        replacement: path.join(monorepoRoot, 'packages/react/src/index.ts'),
      },
      {
        find: '@eigenpal/docx-core/headless',
        replacement: path.join(monorepoRoot, 'packages/core/src/headless.ts'),
      },
      {
        find: '@eigenpal/docx-core/core-plugins',
        replacement: path.join(monorepoRoot, 'packages/core/src/core-plugins/index.ts'),
      },
      {
        find: '@eigenpal/docx-core/mcp',
        replacement: path.join(monorepoRoot, 'packages/core/src/mcp/index.ts'),
      },
      // Wildcard alias for deep core imports (e.g. @eigenpal/docx-core/utils/docxInput)
      {
        find: /^@eigenpal\/docx-core\/(.+)/,
        replacement: path.join(monorepoRoot, 'packages/core/src/$1'),
      },
      // Exact match for bare @eigenpal/docx-core (must come AFTER the prefix match above)
      {
        find: /^@eigenpal\/docx-core$/,
        replacement: path.join(monorepoRoot, 'packages/core/src/core.ts'),
      },
      { find: '@', replacement: path.join(monorepoRoot, 'packages/react/src') },
    ],
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

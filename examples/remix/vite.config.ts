import { defineConfig } from 'vite';
import { vitePlugin as remix } from '@remix-run/dev';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'path';
import fs from 'fs';

const monorepoRoot = path.resolve(__dirname, '../..');
const isMonorepo = fs.existsSync(path.join(monorepoRoot, 'src/index.ts'));

export default defineConfig({
  plugins: [
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_lazyRouteDiscovery: true,
        v3_relativeSplatPath: true,
        v3_singleFetch: true,
        v3_throwAbortReason: true,
      },
    }),
  ],
  define: {
    __ENABLE_FRAMEWORK_SWITCHER__: JSON.stringify(process.env.ENABLE_FRAMEWORK_SWITCHER === 'true'),
  },
  resolve: {
    alias: {
      ...(isMonorepo
        ? { '@eigenpal/docx-js-editor': path.join(monorepoRoot, 'src/index.ts') }
        : {}),
    },
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss({ config: path.join(__dirname, 'tailwind.config.js') }),
        autoprefixer(),
      ],
    },
  },
});

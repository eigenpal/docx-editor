import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(__dirname, '../..');
const isMonorepo = fs.existsSync(path.join(monorepoRoot, 'src/index.ts'));

export default defineConfig({
  integrations: [react()],
  vite: {
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
  },
});

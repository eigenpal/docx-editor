import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { stripUnexpandedTailwind } from '../shared/strip-unexpanded-tailwind';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [
        tailwindcss({ config: path.resolve('../../tailwind.config.js') }),
        autoprefixer(),
        stripUnexpandedTailwind,
      ],
    },
  },
  server: {
    port: Number(process.env.REVIEW_UI_PORT ?? 5180),
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.REVIEW_API_PORT ?? 3180}` },
  },
});

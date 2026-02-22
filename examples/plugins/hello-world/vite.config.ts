import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

const monorepoRoot = path.resolve(__dirname, '../../..');
const isMonorepo = fs.existsSync(path.join(monorepoRoot, 'src/index.ts'));

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  resolve: {
    alias: {
      ...(isMonorepo
        ? { '@eigenpal/docx-js-editor': path.join(monorepoRoot, 'src/index.ts') }
        : {}),
      '@': path.join(monorepoRoot, 'src'),
    },
    // Deduplicate React — ensure a single copy when aliasing into the monorepo
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5175,
    open: false,
  },
  build: {
    outDir: 'dist',
  },
});

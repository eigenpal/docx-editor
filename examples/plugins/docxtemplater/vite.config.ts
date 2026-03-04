import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

const monorepoRoot = path.resolve(__dirname, '../../..');
const isMonorepo = fs.existsSync(path.join(monorepoRoot, 'packages/react/src/index.ts'));

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  resolve: {
    alias: {
      ...(isMonorepo
        ? { '@eigenpal/docx-js-editor': path.join(monorepoRoot, 'packages/react/src/index.ts') }
        : {}),
      '@': path.join(monorepoRoot, 'packages/react/src'),
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

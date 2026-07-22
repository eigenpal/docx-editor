import { defineConfig } from 'vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const browserRoot = join(dirname(fileURLToPath(import.meta.url)), 'browser');

export default defineConfig({
  root: browserRoot,
  build: {
    outDir: join(browserRoot, '../dist/poc-browser'),
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    port: 5199,
    strictPort: true,
  },
});

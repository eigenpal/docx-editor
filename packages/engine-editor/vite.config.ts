import { defineConfig } from 'vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  A11Y_HARNESS_OPTIMIZED_THIRD_PARTY,
  A11Y_HARNESS_WORKSPACE_PACKAGES,
} from './scripts/a11y-harness-vite-policy.ts';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const browserRoot = join(packageRoot, 'browser');
const monorepoRoot = join(packageRoot, '../..');

export default defineConfig({
  root: browserRoot,
  envDir: packageRoot,
  build: {
    outDir: join(packageRoot, 'dist/a11y-harness'),
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
    port: 5299,
    strictPort: true,
    fs: { allow: [monorepoRoot] },
  },
  resolve: {
    preserveSymlinks: true,
  },
  optimizeDeps: {
    // Workspace packages export TypeScript source and change frequently; prebundling
    // caches stale export surfaces (e.g. resolveDefaultWordBoundary in task 5.3).
    exclude: [...A11Y_HARNESS_WORKSPACE_PACKAGES],
    include: [...A11Y_HARNESS_OPTIMIZED_THIRD_PARTY],
  },
});

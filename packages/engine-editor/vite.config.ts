import { defineConfig } from 'vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    include: [
      '@docx-editor.dev/core-contract/editor',
      '@docx-editor.dev/core-contract/interaction',
      '@docx-editor.dev/core-contract/geometry',
      '@docx-editor.dev/core-contract/types',
      '@docx-editor.dev/engine-binding',
      '@docx-editor.dev/engine-core',
      '@docx-editor.dev/engine-layout',
      '@docx-editor.dev/engine-output',
      'prosemirror-model',
      'prosemirror-state',
      'prosemirror-view',
      'prosemirror-commands',
      'prosemirror-keymap',
      'fflate',
    ],
  },
});

// The Vite setup both telemetry examples share: packages resolve to their SOURCE, the demo
// document is served from one file, and the editor stylesheet runs through Tailwind.
//
// `USE_PUBLISHED_PACKAGES=true` drops the aliases, so the app resolves the built `dist/` the
// way an `npm install` consumer does.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';
import type { Alias, Plugin, UserConfig } from 'vite';
import { stripUnexpandedTailwind } from '../../shared/strip-unexpanded-tailwind.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const source = (file: string) => path.join(root, 'packages', file);

/** Exact matches first: a bare prefix would also catch every subpath. */
function sourceAliases(): Alias[] {
  return [
    { find: /^@docx-editor\.dev\/core$/, replacement: source('core/src/index.ts') },
    {
      find: '@docx-editor.dev/core/collaboration/replication',
      replacement: source('core/src/collaboration/replication.ts'),
    },
    {
      find: /^@docx-editor\.dev\/core\/(automation|binding|collaboration|editor|layout|output|store)$/,
      replacement: source('core/src/$1/index.ts'),
    },
    {
      find: /^@docx-editor\.dev\/core\/contracts\/(.+)$/,
      replacement: source('core/src/contracts/$1.ts'),
    },
    { find: '@docx-editor.dev/react', replacement: source('react/src/index.ts') },
    {
      find: '@docx-editor.dev/pro/react/hocuspocus',
      replacement: source('pro/src/react/hocuspocus.ts'),
    },
    { find: /^@docx-editor\.dev\/pro\/react$/, replacement: source('pro/src/react/index.ts') },
    {
      find: '@docx-editor.dev/pro/collaboration/hocuspocus',
      replacement: source('pro/src/collaboration/hocuspocus.ts'),
    },
    {
      find: /^@docx-editor\.dev\/pro\/collaboration$/,
      replacement: source('pro/src/collaboration/index.ts'),
    },
    { find: /^@docx-editor\.dev\/pro$/, replacement: source('pro/src/index.ts') },
    { find: /^@docx-editor\.dev\/telemetry$/, replacement: source('telemetry/src/index.ts') },
    {
      find: /^@docx-editor\.dev\/telemetry\/(otel|sentry|prometheus|server|hocuspocus)$/,
      replacement: source('telemetry/src/$1/index.ts'),
    },
    { find: '@docx-editor.dev/fonts', replacement: source('fonts/src/index.ts') },
    { find: '@docx-editor.dev/i18n', replacement: source('i18n/src/index.ts') },
  ];
}

/** Serve `/sample.docx` from the one copy the public demo opens. */
function sampleDocument(): Plugin {
  const file = path.join(root, 'examples/vite/public/sample.docx');
  return {
    name: 'telemetry-example-sample-document',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/sample.docx') return next();
        readFile(file)
          .then((bytes) => response.end(bytes))
          .catch(next);
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sample.docx', source: await readFile(file) });
    },
  };
}

export function telemetryExampleConfig(port: number): UserConfig {
  return {
    plugins: [react(), sampleDocument()],
    resolve: { alias: process.env.USE_PUBLISHED_PACKAGES === 'true' ? [] : sourceAliases() },
    css: {
      postcss: {
        plugins: [
          tailwindcss({ config: path.join(root, 'tailwind.config.js') }),
          autoprefixer(),
          stripUnexpandedTailwind,
        ],
      },
    },
    server: { port, strictPort: true },
  };
}

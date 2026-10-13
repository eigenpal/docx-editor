import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';
import { withDeclarations } from '../../scripts/build-declarations.mjs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const ENTRIES = {
  index: 'src/index.ts',
  'otel/index': 'src/otel/index.ts',
  'sentry/index': 'src/sentry/index.ts',
  'prometheus/index': 'src/prometheus/index.ts',
  'server/index': 'src/server/index.ts',
  'hocuspocus/index': 'src/hocuspocus/index.ts',
  'ingest/index': 'src/ingest/index.ts',
};

// One build for every entry, so the entries share one copy of the pipeline. Every peer stays
// external: the browser entry must not pull a server dependency, and core must stay one copy.
export default defineConfig(
  withDeclarations(import.meta.url, {
    entry: ENTRIES,
    platform: 'neutral',
    format: ['cjs', 'esm'],
    splitting: true,
    sourcemap: false,
    // The package `build` script empties `dist/` before tsup starts.
    clean: false,
    treeshake: true,
    minify: true,
    metafile: true,
    define: { __DOCX_EDITOR_TELEMETRY_VERSION__: JSON.stringify(version) },
    external: [
      /^@docx-editor\.dev\/core(?:\/|$)/,
      /^@docx-editor\.dev\/pro(?:\/|$)/,
      '@opentelemetry/api',
      '@hocuspocus/server',
      'yjs',
      /^node:/,
    ],
  })
);

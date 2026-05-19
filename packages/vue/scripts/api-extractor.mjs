#!/usr/bin/env node
// Run API Extractor over every published subpath in
// packages/vue/package.json's exports map. Generates one
// `etc/<slug>.api.md` snapshot per entry. Pass `--local` to write/update
// snapshots; default is CI mode (compare and fail on drift).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runApiExtractor } from '../../../scripts/lib/api-extractor-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

runApiExtractor({
  packageRoot,
  isLocal: process.argv.includes('--local'),
  // Strips dev-time `paths` that point at workspace source. Without this,
  // Extractor follows `@eigenpal/docx-editor-i18n` to `../i18n/src/index.ts`
  // and crashes on the JSON locale imports.
  tsconfigPath: path.join(packageRoot, 'tsconfig.api.json'),
  buildHint: "bun run --filter '@eigenpal/docx-editor-vue' build",
});

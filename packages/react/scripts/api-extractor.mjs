#!/usr/bin/env node
// Run API Extractor over every published subpath in
// packages/react/package.json's exports map. Generates one
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
  // Use a paths-stripped tsconfig so Extractor follows `@eigenpal/...`
  // imports via node_modules (resolves to each package's published .d.ts)
  // instead of through dev-time source mappings — those source files import
  // JSON locale data, which Extractor cannot analyze.
  tsconfigPath: path.join(packageRoot, 'tsconfig.api.json'),
  buildHint: "bun run --filter '@eigenpal/docx-editor-react' build",
});

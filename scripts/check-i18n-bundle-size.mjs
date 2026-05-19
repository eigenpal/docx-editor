#!/usr/bin/env node
// Guards the per-locale i18n bundle promise: each `@eigenpal/docx-editor-i18n/<code>`
// subpath ships only that locale's JSON, so dynamic-locale apps code-split
// cleanly.
//
// If a contributor ever adds a value import from `./index` to a per-locale
// `src/<code>.ts` (e.g. `import { deepMerge } from './index'`), tree-shaking
// breaks and the per-locale dist balloons toward the full 235 KB root bundle.
// This check fails loudly when that happens.
//
// Run after `bun run --filter '@eigenpal/docx-editor-i18n' build`.
// Wired into CI in `.github/workflows/ci.yml`.

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocaleCodes } from '../packages/i18n/locale-files.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const i18nDir = join(__dirname, '..', 'packages', 'i18n');
const i18nDist = join(i18nDir, 'dist');

// Current largest per-locale bundle is he.mjs at ~55 KB (Hebrew text encodes
// large in UTF-8). 80 KB gives ~50% headroom for locale growth while still
// catching tree-shake regressions, which typically jump past 100 KB and
// approach the 235 KB root bundle.
const MAX_BYTES = 80 * 1024;

const codes = readLocaleCodes(i18nDir);
if (codes.length === 0) {
  console.error('No locale JSONs found in packages/i18n/.');
  process.exit(1);
}

const errors = [];
const rows = [];

for (const code of codes) {
  for (const ext of ['mjs', 'js']) {
    const file = `${code}.${ext}`;
    const path = join(i18nDist, file);
    if (!existsSync(path)) {
      errors.push(
        `✗ ${file} missing in dist/ — did \`bun run --filter '@eigenpal/docx-editor-i18n' build\` complete?`
      );
      continue;
    }
    const size = statSync(path).size;
    rows.push({ file, size, ok: size <= MAX_BYTES });
    if (size > MAX_BYTES) {
      errors.push(
        `✗ ${file} = ${(size / 1024).toFixed(1)} KB (limit ${MAX_BYTES / 1024} KB)`
      );
    }
  }
}

for (const r of rows) {
  const mark = r.ok ? '✓' : '✗';
  console.log(`${mark} ${r.file.padEnd(14)} ${(r.size / 1024).toFixed(1)} KB`);
}

if (errors.length > 0) {
  console.error('\nPer-locale i18n bundle size exceeded:');
  for (const e of errors) console.error(`  ${e}`);
  console.error('\nLikely cause: a value-position import from `./index` leaked into a');
  console.error('per-locale `src/<code>.ts` source. Each per-locale subpath must');
  console.error('ship only its JSON. Type-only imports (`import type`) are fine —');
  console.error('they erase at build. Value imports do not, and they pull the full');
  console.error('locale map + helpers (deepMerge, createT) into every per-locale bundle.');
  process.exit(1);
}

console.log(
  `\nAll ${rows.length} per-locale bundles under ${MAX_BYTES / 1024} KB.`
);

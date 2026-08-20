#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extractFunctionExports } from './lib/api-snapshot-parse.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const snapshot = readFileSync(path.join(ROOT, 'docs/api/docx-editor-vue/index.api.md'), 'utf8');
const moduleSource = readFileSync(path.join(ROOT, 'packages/nuxt/src/module.ts'), 'utf8');
const listBody = /const VUE_COMPOSABLES = \[([\s\S]*?)\] as const;/.exec(moduleSource)?.[1];

if (!listBody) {
  console.error('Nuxt auto-import check could not parse VUE_COMPOSABLES');
  process.exit(1);
}

const expected = [...extractFunctionExports(snapshot).keys()]
  .filter((name) => /^use[A-Z]/.test(name))
  .sort();
const actual = [...listBody.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
const missing = expected.filter((name) => !actual.includes(name));
const extra = actual.filter((name) => !expected.includes(name));

if (missing.length || extra.length) {
  if (missing.length) console.error(`Nuxt auto-imports missing: ${missing.join(', ')}`);
  if (extra.length) console.error(`Nuxt auto-imports not exported by Vue: ${extra.join(', ')}`);
  process.exit(1);
}

console.log(`✓ Nuxt auto-imports: ${actual.length} Vue composables matched`);

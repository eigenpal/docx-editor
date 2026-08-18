#!/usr/bin/env node
/**
 * Every Vue adapter source file must have a React twin at the same relative path.
 * Deprecated shell-only paths under `components/Toolbar`, `components/TitleBar`, and
 * `managers/` are excluded on both sides.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REACT_SRC = join(ROOT, 'packages/react/src');
const VUE_SRC = join(ROOT, 'packages/vue/src');

const SKIP_PREFIXES = [
  'components/Toolbar',
  'components/TitleBar',
  'components/EditorToolbar',
  'components/PaginatedDocxEditorShell',
  'components/DocxEditor/DocxEditorShell',
  'managers/',
  'hooks/',
];

function shouldSkip(rel) {
  return SKIP_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(base, abs);
    if (statSync(abs).isDirectory()) {
      out.push(...walk(abs, base));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (shouldSkip(rel)) continue;
    out.push(rel);
  }
  return out;
}

function reactTwin(vueRel) {
  const base = vueRel.replace(/\.tsx?$/, '');
  for (const ext of ['.tsx', '.ts']) {
    const candidate = join(REACT_SRC, `${base}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const vueFiles = walk(VUE_SRC);
const missing = vueFiles.filter((rel) => !reactTwin(rel));

if (missing.length) {
  console.error(`Adapter mirror drift: ${missing.length} Vue file(s) without a React twin`);
  for (const rel of missing.slice(0, 40)) console.error(`  vue-only path: ${rel}`);
  if (missing.length > 40) console.error(`  … and ${missing.length - 40} more`);
  process.exit(1);
}

console.log(`✓ adapter mirror: ${vueFiles.length} Vue source paths matched in React`);

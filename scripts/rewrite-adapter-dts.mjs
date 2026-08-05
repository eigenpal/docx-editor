#!/usr/bin/env node
// Rewrite workspace / core-contract specifiers in adapter `.d.ts` to published `@docx-editor.dev/core`.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const distDir = process.argv[2];
if (!distDir) {
  console.error('Usage: node scripts/rewrite-adapter-dts.mjs <distDir>');
  process.exit(1);
}

const PUBLIC_CORE = Object.freeze({
  'contracts/editor': '@docx-editor.dev/core',
  'contracts/types': '@docx-editor.dev/core/types',
  'contracts/types-barrel': '@docx-editor.dev/core/types',
  'contracts/interaction': '@docx-editor.dev/core',
  'contracts/mcp': '@docx-editor.dev/core/mcp',
  'contracts/plugin': '@docx-editor.dev/core/plugin',
  editor: '@docx-editor.dev/core/editor',
  'editor/index': '@docx-editor.dev/core/editor',
  geometry: '@docx-editor.dev/core/geometry',
  plugin: '@docx-editor.dev/core/plugin',
  mcp: '@docx-editor.dev/core/mcp',
  index: '@docx-editor.dev/core',
});

function normalizeSubpath(subpath) {
  return subpath.replace(/\.ts$/, '').replace(/\/index$/, (match, offset) =>
    offset + match.length === subpath.replace(/\.ts$/, '').length ? '' : '/index'
  );
}

function toPublicCoreSpecifier(subpath) {
  const normalized = normalizeSubpath(subpath);
  if (PUBLIC_CORE[normalized]) return PUBLIC_CORE[normalized];
  if (normalized.startsWith('contracts/')) return '@docx-editor.dev/core';
  return `@docx-editor.dev/core/${normalized}`;
}

function rewriteDeclarations(content) {
  let after = content.replace(
    /\.\.\/\.\.\/core\/src\/([^'"]+)/g,
    (_, subpath) => toPublicCoreSpecifier(subpath)
  );
  after = after.replace(
    /@docx-editor\.dev\/core-contract(?:\/([^'"]+))?/g,
    (_, subpath) => (subpath ? toPublicCoreSpecifier(subpath) : '@docx-editor.dev/core')
  );
  after = after.replace(/@docx-editor\.dev\/core-contract/g, '@docx-editor.dev/core');
  return after;
}

let rewritten = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const absolute = path.join(dir, entry);
    if (statSync(absolute).isDirectory()) {
      walk(absolute);
      continue;
    }
    if (!entry.endsWith('.d.ts')) continue;
    const before = readFileSync(absolute, 'utf8');
    const after = rewriteDeclarations(before);
    if (after !== before) {
      writeFileSync(absolute, after);
      rewritten += 1;
    }
  }
}

walk(path.resolve(distDir));
console.log(`[rewrite-adapter-dts] rewritten ${rewritten} declaration file(s) under ${distDir}`);

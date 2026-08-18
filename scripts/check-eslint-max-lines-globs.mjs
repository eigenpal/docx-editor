#!/usr/bin/env node
/**
 * Every file-specific max-lines glob in eslint.config.js must match a real file.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const configPath = join(root, 'eslint.config.js');
const text = readFileSync(configPath, 'utf8');
const filesBlocks = [...text.matchAll(/files:\s*\[([^\]]+)\]/g)];
const paths = new Set();

for (const block of filesBlocks) {
  for (const match of block[1].matchAll(/'([^']+)'|"([^"]+)"/g)) {
    const path = match[1] ?? match[2];
    if (path.includes('*')) continue;
    paths.add(path);
  }
}

const missing = [...paths].filter((path) => !existsSync(join(root, path)));
if (missing.length > 0) {
  console.error('eslint.config.js max-lines globs reference missing files:');
  for (const path of missing) console.error(`  - ${path}`);
  process.exit(1);
}

console.log(`eslint max-lines globs: ${paths.size} file-specific paths, all present`);

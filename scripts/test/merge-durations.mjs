#!/usr/bin/env node
// Merge per-shard test durations into the one cache file that CI shares between runs.
//
//   node scripts/test/merge-durations.mjs --out FILE [BASE] [SHARD_FILE]...
//
// Later files win, so pass the previous cache first and the shards' fresh measurements after
// it. Entries for test files that no longer exist are dropped, so the cache does not grow
// with every renamed or deleted test. A missing or unreadable input is skipped: a lost cache
// costs shard balance, never correctness.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function mergeDurations(sources, exists = (file) => existsSync(join(ROOT, file))) {
  const merged = {};
  for (const source of sources) {
    for (const [file, value] of Object.entries(source)) {
      const entry = typeof value === 'number' ? { ms: value } : value;
      if (entry && Number.isFinite(entry.ms)) merged[file] = entry;
    }
  }
  for (const file of Object.keys(merged)) {
    if (!exists(file)) delete merged[file];
  }
  return merged;
}

function readSource(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    console.log(`Skipping unreadable durations file ${file}`);
    return {};
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  if (outIndex === -1 || !args[outIndex + 1]) {
    console.error('Usage: merge-durations.mjs --out FILE [BASE] [SHARD_FILE]...');
    process.exit(1);
  }
  const out = args[outIndex + 1];
  const inputs = args.filter((_, index) => index !== outIndex && index !== outIndex + 1);
  const merged = mergeDurations(inputs.map(readSource));
  writeFileSync(out, JSON.stringify(merged));
  console.log(`Merged ${inputs.length} durations files into ${Object.keys(merged).length} entries`);
}

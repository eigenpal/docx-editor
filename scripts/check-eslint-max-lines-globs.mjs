#!/usr/bin/env node
/**
 * The per-file max-lines caps in eslint.config.js stay honest.
 *
 * Two checks over the imported config (imported, not regex-parsed, so a config the linter
 * would reject fails here too):
 *
 * 1. Every non-glob `files` path exists — a cap for a deleted file is dead weight.
 * 2. Every per-file cap is a RATCHET, not a permanent ceiling: the cap must sit within
 *    SLACK lines of the file's current length. Without this, a file that shrinks by 800
 *    lines keeps its inflated ceiling forever and the "nothing here can grow" claim in the
 *    config is only true at the moment a cap is written. A file that comes down: lower its
 *    cap (or delete the block once it fits the global 1000).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// 150, not 100: with caps set ~100 over their file, a tighter slack made ONE deleted line
// in a capped file a lint failure until the config moved too. 150 keeps the ratchet and
// gives cleanup PRs a real margin.
const SLACK = 150;

/** Paths allowed to hold headroom beyond SLACK, each with its reason. */
const SLACK_EXEMPT = new Map([
  [
    'docs/site/data/word-features.ts',
    'the feature matrix grows by design; its cap buys headroom so shipping a feature never negotiates with the linter',
  ],
]);

const root = join(import.meta.dirname, '..');
const configs = (await import(pathToFileURL(join(root, 'eslint.config.js')).href)).default;

const failures = [];
let checked = 0;

for (const block of configs) {
  const cap = block.rules?.['max-lines']?.[1]?.max;
  if (cap === undefined || !Array.isArray(block.files)) continue;
  for (const path of block.files) {
    if (path.includes('*')) continue;
    const absolute = join(root, path);
    if (!existsSync(absolute)) {
      failures.push(`missing file: ${path} (cap ${cap})`);
      continue;
    }
    checked += 1;
    const lines = readFileSync(absolute, 'utf8').split('\n').length - 1;
    if (lines > cap) {
      // eslint reports this too; repeating it keeps this script self-contained.
      failures.push(`over cap: ${path} is ${lines} lines, cap ${cap}`);
    } else if (cap - lines > SLACK && !SLACK_EXEMPT.has(path)) {
      failures.push(
        `stale cap: ${path} is ${lines} lines but capped at ${cap} — ` +
          `lower the cap to within ${SLACK} lines (or delete the block once it fits the global cap)`
      );
    }
  }
}

if (failures.length > 0) {
  console.error('eslint.config.js max-lines caps are stale or broken:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`eslint max-lines caps: ${checked} file-specific paths present and within ${SLACK} lines of their cap`);

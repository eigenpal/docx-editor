#!/usr/bin/env node
/**
 * The per-file max-lines caps in eslint.config.js stay honest.
 *
 * Three checks. The first two run over the imported config (imported, not regex-parsed, so a
 * config the linter would reject fails here too):
 *
 * 1. Every non-glob `files` path exists — a cap for a deleted file is dead weight.
 * 2. Every per-file cap is a RATCHET, not a permanent ceiling: the cap must sit within
 *    SLACK lines of the file's current length. Without this, a file that shrinks by 800
 *    lines keeps its inflated ceiling forever and the "nothing here can grow" claim in the
 *    config is only true at the moment a cap is written. A file that comes down: lower its
 *    cap (or delete the block once it fits the global 1000).
 * 3. A file that turns the rule off for itself is held to a length declared HERE. Checks 1 and
 *    2 only see files the config names, so a file-level `eslint-disable max-lines` header opted
 *    a file out of the ratchet entirely: it needed no config block, and nothing observed it
 *    growing. Not theoretical — a review caught `paginated-surface.ts` taking on another 243
 *    lines that way. Growth stays allowed; going unnoticed does not.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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

/**
 * Files that switch `max-lines` off for themselves, each with the length it is held to.
 *
 * These are deliberate — a composition root, a paint seam — so an entry is a length, not a ban.
 * Growing one past its number is a one-line change here, which is the point: it lands in the
 * diff where a reviewer sees it, instead of the file quietly gaining a thousand lines.
 */
const BLANKET_DISABLES = new Map([
  ['packages/core/src/editor/paginated-surface.ts', 6271],
  ['packages/core/src/store/store/tree-op-apply.ts', 3495],
  ['packages/core/src/output/semantic-paint.ts', 3009],
  ['packages/core/src/layout/note-pagination.ts', 2954],
  ['packages/core/src/store/package/note-lifecycle.ts', 1320],
]);

/** A file-level `eslint-disable` naming max-lines. `-next-line` is one statement, not a file. */
const BLANKET_DISABLE = /\/\*\s*eslint-disable\s(?![^*]*-next-line)[^*]*max-lines/;

const SOURCE_FILE = /\.tsx?$/;
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'dist-types', 'temp', '.turbo']);

function sourceFilesUnder(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) sourceFilesUnder(join(directory, entry.name), found);
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(join(directory, entry.name));
    }
  }
  return found;
}

const root = join(import.meta.dirname, '..');
const configs = (await import(pathToFileURL(join(root, 'eslint.config.js')).href)).default;

const failures = [];
let checked = 0;
let blanketChecked = 0;

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

const seenBlanket = new Set();
for (const absolute of sourceFilesUnder(join(root, 'packages'))) {
  const text = readFileSync(absolute, 'utf8');
  if (!BLANKET_DISABLE.test(text)) continue;
  const path = relative(root, absolute).split(sep).join('/');
  seenBlanket.add(path);
  const lines = text.split('\n').length - 1;
  const declared = BLANKET_DISABLES.get(path);
  if (declared === undefined) {
    failures.push(
      `undeclared blanket disable: ${path} turns max-lines off for the whole file (${lines} lines). ` +
        `Add it to BLANKET_DISABLES with its length, or give it a capped block in eslint.config.js`
    );
    continue;
  }
  blanketChecked += 1;
  if (lines > declared) {
    failures.push(
      `grew behind a blanket disable: ${path} is ${lines} lines, declared ${declared} ` +
        `(+${lines - declared}) — extract, or raise the declared length deliberately`
    );
  } else if (declared - lines > SLACK) {
    failures.push(
      `stale blanket declaration: ${path} is ${lines} lines but declared ${declared} — ` +
        `lower it to within ${SLACK} lines (or drop the disable once it fits a cap)`
    );
  }
}
for (const path of BLANKET_DISABLES.keys()) {
  if (!seenBlanket.has(path)) {
    failures.push(
      `declared blanket disable not found: ${path} no longer disables max-lines (or is gone) — remove the entry`
    );
  }
}

if (failures.length > 0) {
  console.error('eslint.config.js max-lines caps are stale or broken:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `eslint max-lines caps: ${checked} file-specific paths present and within ${SLACK} lines of their cap; ` +
    `${blanketChecked} blanket disables at their declared length`
);

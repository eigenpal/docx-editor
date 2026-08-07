#!/usr/bin/env node
/**
 * Every key in `en.json` must be reachable from shipping code.
 *
 * A catalogue key is not free: every community locale has to carry it (a missing key
 * fails `i18n:validate`), so a string no component renders is work asked of translators
 * for nothing. Half the catalogue had drifted that way — families belonging to dialogs
 * that stopped shipping — before this check existed.
 *
 * A key counts as used when a source file names it verbatim, or when it sits under a
 * prefix some file builds a key from (`t(`navigation.tabs.${id}`)`). Tests and prose do
 * NOT count: a key kept alive only by the test that asserts it exists is still dead.
 *
 *   node scripts/check-i18n-unused.mjs           # fail on unused keys
 *   node scripts/check-i18n-unused.mjs --list    # print them, exit 0
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGUE = join(ROOT, 'packages/i18n/en.json');

/** Directories that never hold usage. */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.next', 'build', '.astro']);
/** Where shipping source lives. Docs and the locale JSONs are deliberately absent. */
const SOURCE_ROOTS = ['packages', 'examples', 'scripts'];
/**
 * The Vue and Nuxt adapters are work in progress and do not ship, so a key only THEY name
 * is still dead weight in every community locale. They keep the catalogue honest by being
 * excluded here: when they ship, drop this and the keys they need come back with them.
 */
const UNSHIPPED = /^(packages|examples)\/(vue|nuxt)\//;
const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|astro|svelte|json|html|css)$/;
const TEST_FILE = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\./;
/** The locale JSONs are the catalogue, not a reference to it. */
const LOCALE_JSON = /packages\/i18n\/[A-Za-z-]+\.json$/;

/** `"prefix.` immediately followed by an interpolation or a concatenation. */
const DYNAMIC_PREFIX = /[`'"]([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*\.)(?:\$\{|['"]\s*\+)/g;

/**
 * Block comments, and lines that are nothing but a comment.
 *
 * A key named only in a docstring is not rendered by anything, and TSDoc naming a key
 * that no longer exists is how the last stale examples survived the previous sweep. Only
 * whole-line `//` goes: a trailing one can hold a URL whose `//` would eat real code.
 */
const COMMENT = /\/\*[\s\S]*?\*\/|^[ \t]*\/\/.*$/gm;

/**
 * `key` as a whole path, not as the head of a longer one: `dialogs.imageProperties.width`
 * must not count as used because `widthLabel` is. Anything that can continue the path
 * means this was a different, longer key.
 */
function names(blob, key) {
  let from = 0;
  for (;;) {
    const at = blob.indexOf(key, from);
    if (at < 0) return false;
    if (!/[A-Za-z0-9_.]/.test(blob[at + key.length] ?? '')) return true;
    from = at + 1;
  }
}

function leafKeys(node, path, out) {
  for (const [key, value] of Object.entries(node)) {
    const next = path ? `${path}.${key}` : key;
    if (value && typeof value === 'object') leafKeys(value, next, out);
    else out.push(next);
  }
  return out;
}

function sourceFiles() {
  const files = [];
  for (const root of SOURCE_ROOTS) {
    const abs = join(ROOT, root);
    try {
      statSync(abs);
    } catch {
      continue;
    }
    (function collect(dir) {
      for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          collect(path);
          continue;
        }
        const rel = relative(ROOT, path);
        if (!SOURCE_FILE.test(rel) || TEST_FILE.test(rel) || LOCALE_JSON.test(rel)) continue;
        if (UNSHIPPED.test(rel)) continue;
        files.push(path);
      }
    })(abs);
  }
  return files;
}

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const keys = leafKeys(catalogue, '', []).filter((key) => key !== '_lang');
const blob = sourceFiles()
  .map((file) => readFileSync(file, 'utf8').replace(COMMENT, ''))
  .join('\n');

const prefixes = [...new Set([...blob.matchAll(DYNAMIC_PREFIX)].map((match) => match[1]))];
const unused = keys.filter(
  (key) => !names(blob, key) && !prefixes.some((prefix) => key.startsWith(prefix))
);

if (process.argv.includes('--list')) {
  console.log(unused.join('\n'));
  process.exit(0);
}

if (unused.length === 0) {
  console.log(`✓ i18n: all ${keys.length} catalogue keys are referenced by shipping code`);
  process.exit(0);
}

console.error(`✖ i18n: ${unused.length} of ${keys.length} keys in en.json are never used:`);
for (const key of unused.slice(0, 40)) console.error(`    - ${key}`);
if (unused.length > 40) console.error(`    ... and ${unused.length - 40} more`);
console.error(
  '\nDelete them from packages/i18n/en.json and run `bun run i18n:fix`, or reference them.\n' +
    'A key built at runtime is fine — write the static part as one literal so it is visible\n' +
    "here (`t(`navigation.tabs.${'${id}'}`)`), not assembled from fragments."
);
process.exit(1);

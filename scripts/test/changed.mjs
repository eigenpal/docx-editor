#!/usr/bin/env node
// Run only the test files that your change can affect.
//
//   bun run test:changed [--base REF] [--list] [-- <runner args>]
//
// The change is everything that differs from the merge base with main: commits on this branch,
// staged and unstaged edits, and untracked files. A test file is affected when it imports a
// changed file, directly or through any chain of imports, including workspace imports such as
// `@docx-editor.dev/core/editor`.
//
// The selection only ever errs toward running more. A change that the import graph cannot
// follow runs the whole suite: dependency and TypeScript configuration, the test runner and its
// preloads, or a non-code file that no source names. A non-code file that sources DO name (a
// fixture read with `readFileSync`) counts as a change to those sources. CI still runs the
// whole suite on every pull request.
//
// `--list` prints the selection without running it. Everything after `--` goes to the runner,
// for example `bun run test:changed -- --jobs 4`.

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEARCH_ROOTS = ['packages', 'scripts', 'docs', 'examples', 'benchmarks', 'e2e', 'api'];
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'dist-types', 'temp', '.turbo', '.next']);
const CODE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/;
/** Where `bun run test` looks for test files; the graph also reads e2e/ and api/ sources. */
const SUITE_ROOTS = /^(packages|scripts|docs|examples|benchmarks)\//;
const RESOLVE_EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx', '.cjs', '.vue'];
const WORKSPACE_SCOPE = '@docx-editor.dev/';

/** Changes the import graph cannot see through. Any of these runs the whole suite. */
const RUN_EVERYTHING = [
  /^(packages\/[^/]+\/|examples\/[^/]+\/|benchmarks\/[^/]+\/)?package\.json$/,
  /^bun\.lock$/,
  /^bunfig\.toml$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /^scripts\/test\//,
  /^packages\/vue\/test\/bun-plugin-jsx\.ts$/,
];
/** Changes that cannot affect a unit test. */
const IGNORED = [/\.mdx?$/, /^\.changeset\//, /^openspec\//, /^\.github\//, /^\.husky\//];

const IMPORT_PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function walk(directory, found = []) {
  if (!existsSync(directory)) return found;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) walk(join(directory, entry.name), found);
    } else if (CODE_FILE.test(entry.name)) {
      found.push(relative(ROOT, join(directory, entry.name)));
    }
  }
  return found;
}

function isFile(path) {
  try {
    return statSync(join(ROOT, path)).isFile();
  } catch {
    return false;
  }
}

/** `base` with each extension, then as a directory index. Also maps `x.js` to `x.ts`. */
function resolveFile(base) {
  const candidates = [];
  for (const extension of RESOLVE_EXTENSIONS) candidates.push(base + extension);
  for (const extension of RESOLVE_EXTENSIONS.slice(1))
    candidates.push(join(base, 'index' + extension));
  const jsTwin = base.replace(/\.(m|c)?js$/, '.$1ts').replace(/\.jsx$/, '.tsx');
  if (jsTwin !== base) candidates.unshift(jsTwin);
  return candidates.find(isFile) ?? null;
}

/**
 * The repository file a specifier names, a `package:<dir>` node when only the workspace package
 * is known, or null for an external module.
 */
export function resolveSpecifier(from, specifier) {
  if (specifier.startsWith('.')) {
    return resolveFile(join(dirname(from), specifier));
  }
  if (specifier.startsWith(WORKSPACE_SCOPE)) {
    const [name, ...rest] = specifier.slice(WORKSPACE_SCOPE.length).split('/');
    const sub = rest.join('/');
    const source = join('packages', name, 'src');
    return resolveFile(join(source, sub || 'index')) ?? `package:packages/${name}`;
  }
  if (specifier.startsWith('@/')) {
    return resolveFile(join('packages/react/src', specifier.slice(2)));
  }
  return null;
}

/** Map every code file to the files that import it. */
export function importers(files, read = (file) => readFileSync(join(ROOT, file), 'utf8')) {
  const reverse = new Map();
  const add = (target, source) => {
    if (!reverse.has(target)) reverse.set(target, new Set());
    reverse.get(target).add(source);
  };
  for (const file of files) {
    const text = read(file);
    for (const pattern of IMPORT_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const target = resolveSpecifier(file, match[1]);
        if (target) add(target, file);
      }
    }
  }
  return reverse;
}

/** The strings a source would use to name `file`: its name, then its enclosing directories. */
function namesFor(file) {
  const names = [basename(file)];
  const parts = file.split('/').slice(0, -1);
  for (let end = parts.length; end > 0; end -= 1) {
    const directory = parts.slice(0, end).join('/');
    // A bare top-level folder such as `packages` names nearly everything; stop above it.
    if (end > 1 || directory.startsWith('.')) names.push(directory);
  }
  return names;
}

/** The package node a file belongs to, so importers that only name the package are reached. */
function packageNode(file) {
  const match = /^packages\/([^/]+)\//.exec(file);
  return match ? `package:packages/${match[1]}` : null;
}

/**
 * Select the affected test files. Returns `{ all: true, reason }` when the whole suite must run.
 */
export function selectTests(changed, files, reverse, read) {
  const code = new Set(files);
  const seeds = new Set();
  for (const file of changed) {
    if (IGNORED.some((pattern) => pattern.test(file))) continue;
    if (RUN_EVERYTHING.some((pattern) => pattern.test(file))) {
      return { all: true, reason: `${file} changes how every test runs` };
    }
    if (code.has(file)) {
      seeds.add(file);
      continue;
    }
    // A deleted source, or a fixture or other data file: whoever names it is affected. Data
    // read a directory at a time is named by its directory, so try the file name first, then
    // each enclosing directory from the deepest up.
    const namers = namesFor(file).reduce(
      (found, name) =>
        found.length > 0 ? found : files.filter((candidate) => read(candidate).includes(name)),
      []
    );
    if (namers.length === 0) {
      return { all: true, reason: `no source names ${file}, so its effect is unknown` };
    }
    for (const namer of namers) seeds.add(namer);
  }

  const affected = new Set();
  const queue = [...seeds];
  for (const seed of seeds) {
    const node = packageNode(seed);
    if (node) queue.push(node);
  }
  while (queue.length > 0) {
    const node = queue.pop();
    if (affected.has(node)) continue;
    affected.add(node);
    for (const importer of reverse.get(node) ?? []) queue.push(importer);
  }
  const tests = [...affected]
    .filter((file) => TEST_FILE.test(file) && SUITE_ROOTS.test(file))
    .sort();
  return { all: false, tests };
}

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function changedFiles(base) {
  const mergeBase = git('merge-base', 'HEAD', base)[0];
  return [
    ...new Set([
      ...git('diff', '--name-only', mergeBase),
      ...git('ls-files', '--others', '--exclude-standard'),
    ]),
  ];
}

function parseArguments(argv) {
  const separator = argv.indexOf('--');
  const own = separator === -1 ? argv : argv.slice(0, separator);
  const passthrough = separator === -1 ? [] : argv.slice(separator + 1);
  let base = 'origin/main';
  let list = false;
  for (let index = 0; index < own.length; index += 1) {
    if (own[index] === '--base') base = own[++index];
    else if (own[index] === '--list') list = true;
    else {
      console.error(
        `Unknown option ${own[index]}. Usage: test:changed [--base REF] [--list] [-- <runner args>]`
      );
      process.exit(1);
    }
  }
  return { base, list, passthrough };
}

function main() {
  const { base, list, passthrough } = parseArguments(process.argv.slice(2));
  const changed = changedFiles(base);
  if (changed.length === 0) {
    console.log(`No changes against ${base}; nothing to test.`);
    return 0;
  }
  const files = SEARCH_ROOTS.flatMap((root) => walk(join(ROOT, root)));
  const cache = new Map();
  const read = (file) => {
    if (!cache.has(file)) cache.set(file, readFileSync(join(ROOT, file), 'utf8'));
    return cache.get(file);
  };
  const selection = selectTests(changed, files, importers(files, read), read);
  const runner = join(ROOT, 'scripts/test/run-parallel.mjs');

  if (selection.all) {
    console.log(`Running the whole suite: ${selection.reason}.`);
    if (list) return 0;
    return spawnSync('node', [runner, ...passthrough], { cwd: ROOT, stdio: 'inherit' }).status ?? 1;
  }
  if (selection.tests.length === 0) {
    console.log(`${changed.length} changed files affect no test file.`);
    return 0;
  }
  console.log(`${changed.length} changed files affect ${selection.tests.length} test files.`);
  if (list) {
    for (const test of selection.tests) console.log(`  ${test}`);
    return 0;
  }
  const listFile = join(mkdtempSync(join(tmpdir(), 'test-changed-')), 'tests.txt');
  writeFileSync(listFile, selection.tests.join('\n'));
  return (
    spawnSync('node', [runner, '--only', listFile, ...passthrough], { cwd: ROOT, stdio: 'inherit' })
      .status ?? 1
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());

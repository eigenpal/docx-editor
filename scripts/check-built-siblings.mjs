// Fails a package build when a sibling package it types against has no current build.
//
// Package declaration builds read their siblings' built `dist/*.d.ts`, not their sources
// (compiling the sources again used four times the memory). `bun run typecheck` still reads
// sources, so a stale sibling build would pass typecheck and then publish old types without
// a word. `build:packages` builds siblings first; this names the sibling to build when a
// package is built by itself.
//
// Usage: node ../../scripts/check-built-siblings.mjs core react

import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packages = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages');

/** Modification times of the files under `dir` that match `test`, skipping tests. */
function mtimes(dir, test) {
  const times = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (test(entry.name)) times.push(statSync(path).mtimeMs);
    }
  };
  try {
    walk(dir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return times;
}

const problems = [];
for (const sibling of process.argv.slice(2)) {
  const root = join(packages, sibling);
  const built = mtimes(join(root, 'dist'), (name) => name.endsWith('.d.ts'));
  // Everything that shapes the emitted declarations: sources, and the root JSON files
  // (package.json exports, tsconfig, and generated inputs such as i18n's en.json).
  const sources = [
    ...mtimes(
      join(root, 'src'),
      (name) => /\.(tsx?|vue|json)$/.test(name) && !/\.test\./.test(name)
    ),
    ...readdirSync(root)
      .filter((name) => name.endsWith('.json'))
      .map((name) => statSync(join(root, name)).mtimeMs),
  ];
  if (built.length === 0) problems.push(`${sibling} has no built declarations`);
  else if (Math.max(...sources) > Math.min(...built))
    problems.push(`${sibling}'s built declarations are older than its source`);
}
if (problems.length > 0) {
  console.error(
    `${problems.join('; ')}. This package's declarations read them. ` +
      'Run `bun run build:packages`, or build those packages first.'
  );
  process.exit(1);
}

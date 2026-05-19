#!/usr/bin/env node
// Single entry for `api:extract` / `api:check` across every published
// package. Reads `scripts/lib/packages.mjs` for the package table.
//
// Usage:
//   node scripts/api-extractor.mjs                          # all packages, CI mode
//   node scripts/api-extractor.mjs --local                  # all packages, write snapshots
//   node scripts/api-extractor.mjs --package <name>         # one package, CI mode
//   node scripts/api-extractor.mjs --package <name> --local # one package, write
//
// Per-package `package.json` scripts delegate here with `--package <name>`
// so `bun run --filter '<pkg>' api:extract` still works the way every
// other workspace script does.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runApiExtractor } from './lib/api-extractor-runner.mjs';
import { PACKAGES, packageByName, buildHintFor, reportDirFor } from './lib/packages.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const isLocal = args.includes('--local');
const pkgArgIdx = args.indexOf('--package');
// `--package` requires a following value. Without this guard,
// `... --package` (no value) and `... --package --local` would silently
// fall through to "no filter" and run all 5 packages — confusing when
// the user expected to scope to one.
if (pkgArgIdx !== -1) {
  const next = args[pkgArgIdx + 1];
  if (!next || next.startsWith('--')) {
    console.error(`--package requires a value, e.g. --package @eigenpal/docx-editor-core`);
    process.exit(1);
  }
}
const pkgArg = pkgArgIdx !== -1 ? args[pkgArgIdx + 1] : null;

if (pkgArg && !pkgArg.startsWith('@')) {
  console.error(`--package expects a package name like '@eigenpal/docx-editor-core', got '${pkgArg}'`);
  process.exit(1);
}

const targets = pkgArg ? [packageByName(pkgArg)] : PACKAGES;
if (pkgArg && !targets[0]) {
  console.error(`Unknown package '${pkgArg}'. Known packages:`);
  for (const p of PACKAGES) console.error(`  - ${p.name}`);
  process.exit(1);
}

for (const pkg of targets) {
  runApiExtractor({
    packageRoot: path.join(repoRoot, pkg.root),
    reportDir: reportDirFor(pkg, repoRoot),
    isLocal,
    buildHint: buildHintFor(pkg),
    tsconfigPath: pkg.tsconfigPath ? path.join(repoRoot, pkg.tsconfigPath) : undefined,
  });
}

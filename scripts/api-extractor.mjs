#!/usr/bin/env node
// Single entry for `api:extract` / `api:check` across every published
// package. Reads `scripts/lib/packages.mjs` for the package table.
//
// Usage:
//   node scripts/api-extractor.mjs                          # all packages, CI mode
//   node scripts/api-extractor.mjs --local                  # all packages, write snapshots
//   node scripts/api-extractor.mjs --package <name>         # one package, CI mode
//   node scripts/api-extractor.mjs --package <name> --local # one package, write
//   node scripts/api-extractor.mjs --local --record-forgotten-exports
//       # rewrite the forgotten-export baseline for every package (review the diff first)
//
// Forgotten exports: every package reports them. A warning not in the package's reviewed
// allowlist (`scripts/lib/packages.mjs`) or in `scripts/api-forgotten-exports.baseline.json`
// fails the run, and so does a baseline entry that no longer warns in CI mode. Only
// `--record-forgotten-exports` writes the baseline: it drops stale entries, adds new ones, and
// writes the file once after every package has run.
//
// Per-package `package.json` scripts delegate here with `--package <name>`
// so `bun run --filter '<pkg>' api:extract` still works the way every
// other workspace script does.

import path from 'node:path';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runApiExtractor } from './lib/api-extractor-runner.mjs';
import { PACKAGES, packageByName, buildHintFor, reportDirFor } from './lib/packages.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const isLocal = args.includes('--local');
const recordForgottenExports = args.includes('--record-forgotten-exports');
if (recordForgottenExports && !isLocal) {
  console.error('--record-forgotten-exports writes the baseline, so it requires --local');
  process.exit(1);
}
if (recordForgottenExports && args.includes('--package')) {
  // One run writes the one file. Per-package runs in parallel would overwrite each other.
  console.error('--record-forgotten-exports records every package at once; drop --package');
  process.exit(1);
}
const forgottenExportBaselinePath = path.join(
  repoRoot,
  'scripts',
  'api-forgotten-exports.baseline.json'
);
const pkgArgIdx = args.indexOf('--package');
// `--package` requires a following value. Without this guard,
// `... --package` (no value) and `... --package --local` would silently
// fall through to "no filter" and run all 5 packages — confusing when
// the user expected to scope to one.
if (pkgArgIdx !== -1) {
  const next = args[pkgArgIdx + 1];
  if (!next || next.startsWith('--')) {
    console.error(`--package requires a value, e.g. --package @docx-editor.dev/core`);
    process.exit(1);
  }
}
const pkgArg = pkgArgIdx !== -1 ? args[pkgArgIdx + 1] : null;

if (pkgArg && !pkgArg.startsWith('@')) {
  console.error(`--package expects a package name like '@docx-editor.dev/core', got '${pkgArg}'`);
  process.exit(1);
}

const targets = pkgArg ? [packageByName(pkgArg)] : PACKAGES;
if (pkgArg && !targets[0]) {
  console.error(`Unknown package '${pkgArg}'. Known packages:`);
  for (const p of PACKAGES) console.error(`  - ${p.name}`);
  process.exit(1);
}

const recordedBaselines = new Map();
for (const pkg of targets) {
  if (pkg.disconnected) {
    // A disconnected package is skipped LOUDLY, never silently. And if it turns out to
    // have a build after all, the exemption has outlived its reason and must be removed
    // rather than quietly keeping the package out of the API gate forever.
    const distDir = path.join(repoRoot, pkg.root, 'dist');
    if (existsSync(distDir) && readdirSync(distDir).some((f) => f.endsWith('.d.ts'))) {
      console.error(
        `${pkg.name} is marked disconnected but has built .d.ts files. ` +
          `Remove the 'disconnected' flag in scripts/lib/packages.mjs so its API surface is checked again.`
      );
      process.exit(1);
    }
    console.warn(`SKIPPED ${pkg.name}: ${pkg.disconnected}`);
    continue;
  }
  const result = runApiExtractor({
    packageRoot: path.join(repoRoot, pkg.root),
    reportDir: reportDirFor(pkg, repoRoot),
    isLocal,
    buildHint: buildHintFor(pkg),
    tsconfigPath: pkg.tsconfigPath ? path.join(repoRoot, pkg.tsconfigPath) : undefined,
    forgottenExports: pkg.forgottenExports ?? 'warning',
    forgottenExportBaselinePath,
    recordForgottenExports,
  });
  if (result?.nextForgottenExportBaseline) {
    recordedBaselines.set(pkg.name, result.nextForgottenExportBaseline);
  }
}

if (recordForgottenExports) {
  const sorted = {};
  for (const name of [...recordedBaselines.keys()].sort()) {
    const entries = recordedBaselines.get(name);
    if (Object.keys(entries).length > 0) sorted[name] = entries;
  }
  const text = `${JSON.stringify(sorted, null, 2)}\n`;
  const previous = existsSync(forgottenExportBaselinePath)
    ? readFileSync(forgottenExportBaselinePath, 'utf8')
    : null;
  if (previous !== text) writeFileSync(forgottenExportBaselinePath, text);
  console.log(`Forgotten-export baseline recorded for ${recordedBaselines.size} packages.`);
}

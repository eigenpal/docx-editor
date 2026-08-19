#!/usr/bin/env node
// Package size report + gate for the packages we publish.
//
// Measure mode (default): runs `npm pack --dry-run --json` in every
// non-private `packages/*` directory and records the tarball (gzipped) and
// unpacked byte sizes — the exact artifact `npm publish` ships, honoring each
// package's `files` array. Run after `bun run build:packages`; a missing
// `dist/` fails loudly instead of reporting a near-empty tarball.
//
//   node scripts/check-package-size.mjs [--out package-sizes.json]
//
// Compare mode: diffs a current report against a baseline report (the same
// JSON produced on main) and writes a Markdown table for a PR comment. Exits
// non-zero when any package's tarball grows past BOTH fail thresholds, so an
// accidental multi-hundred-KB regression (a bundled dependency, an asset, a
// broken tree-shake) blocks the PR instead of shipping.
//
//   node scripts/check-package-size.mjs --compare current.json \
//     --baseline baseline.json [--comment comment.md]
//
// A deliberate size increase passes with PACKAGE_SIZE_ALLOW_GROWTH=1, which
// CI sets from the `size-increase-expected` PR label.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// Warn (⚠️ in the comment) when a tarball moves by more than 5% AND 1 KB.
const WARN_PCT = 5;
const WARN_BYTES = 1024;
// Fail the gate when a tarball GROWS by more than 20% AND 25 KB. Both must
// trip: 20% of a 2 KB package is noise, and +25 KB on a 5 MB package is not
// the regression this gate exists for.
const FAIL_PCT = 20;
const FAIL_BYTES = 25 * 1024;

function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function formatDelta(delta, base) {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  const abs = Math.abs(delta);
  const pct = base > 0 ? ` (${sign}${((abs / base) * 100).toFixed(1)}%)` : '';
  return `${sign}${formatBytes(abs)}${pct}`;
}

// Note: `npm pack --dry-run` runs `prepack` lifecycle scripts. All published
// packages today have none; if a package with one (e.g. nuxt) ever drops
// `private: true`, its `prepack` will run inside this measurement.
function publishedPackageDirs() {
  const dirs = [];
  for (const entry of readdirSync(join(ROOT, 'packages'))) {
    const manifestPath = join(ROOT, 'packages', entry, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.private) continue;
    dirs.push({ dir: join(ROOT, 'packages', entry), name: manifest.name });
  }
  return dirs.sort((a, b) => a.name.localeCompare(b.name));
}

function measure() {
  const results = [];
  for (const { dir, name } of publishedPackageDirs()) {
    if (!existsSync(join(dir, 'dist'))) {
      console.error(`✗ ${name}: dist/ missing — run \`bun run build:packages\` first.`);
      process.exit(1);
    }
    const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const [packed] = JSON.parse(output);
    if (
      !packed?.name ||
      typeof packed.size !== 'number' ||
      typeof packed.unpackedSize !== 'number'
    ) {
      console.error(`✗ ${name}: npm pack returned no size.`);
      process.exit(1);
    }
    results.push({
      name: packed.name,
      version: packed.version,
      tarballBytes: packed.size,
      unpackedBytes: packed.unpackedSize,
      entryCount: packed.entryCount,
    });
  }
  return results;
}

function printTable(results) {
  const nameWidth = Math.max(...results.map((r) => r.name.length), 7);
  console.log(`${'package'.padEnd(nameWidth)}  ${'tarball'.padStart(10)}  ${'unpacked'.padStart(10)}  files`);
  for (const r of results) {
    console.log(
      `${r.name.padEnd(nameWidth)}  ${formatBytes(r.tarballBytes).padStart(10)}  ${formatBytes(r.unpackedBytes).padStart(10)}  ${r.entryCount}`
    );
  }
}

function compare(currentPath, baselinePath, commentPath) {
  const current = JSON.parse(readFileSync(currentPath, 'utf8'));
  // A malformed baseline (truncated artifact, interrupted upload on main)
  // degrades to the no-baseline path instead of crashing before the comment
  // file exists — the gate must stay explainable. A malformed CURRENT report
  // still crashes above: that is a real error in this run.
  let baseline = null;
  if (existsSync(baselinePath)) {
    try {
      const parsed = JSON.parse(readFileSync(baselinePath, 'utf8'));
      if (Array.isArray(parsed)) baseline = parsed;
      else console.error(`Baseline ${baselinePath} is not an array; ignoring it.`);
    } catch (error) {
      console.error(`Baseline ${baselinePath} is unreadable (${error.message}); ignoring it.`);
    }
  }
  const baseByName = new Map((baseline ?? []).map((r) => [r.name, r]));

  const lines = [
    '<!-- package-size-report -->',
    '### 📦 Package size report',
    '',
    '| Package | Tarball | vs main | Unpacked | vs main |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];
  const failures = [];

  for (const r of current) {
    const base = baseByName.get(r.name);
    baseByName.delete(r.name);
    if (!base) {
      const label = baseline ? '🆕 new' : '—';
      lines.push(
        `| \`${r.name}\` | ${formatBytes(r.tarballBytes)} | ${label} | ${formatBytes(r.unpackedBytes)} | ${label} |`
      );
      continue;
    }
    const tarballDelta = r.tarballBytes - base.tarballBytes;
    const unpackedDelta = r.unpackedBytes - base.unpackedBytes;
    const warn =
      Math.abs(tarballDelta) > WARN_BYTES &&
      Math.abs(tarballDelta) / base.tarballBytes > WARN_PCT / 100;
    const fail =
      tarballDelta > FAIL_BYTES && tarballDelta / base.tarballBytes > FAIL_PCT / 100;
    if (fail) failures.push({ name: r.name, tarballDelta, base: base.tarballBytes });
    const mark = fail ? ' 🚨' : warn ? ' ⚠️' : '';
    lines.push(
      `| \`${r.name}\` | ${formatBytes(r.tarballBytes)} | ${formatDelta(tarballDelta, base.tarballBytes)}${mark} | ${formatBytes(r.unpackedBytes)} | ${formatDelta(unpackedDelta, base.unpackedBytes)} |`
    );
  }
  for (const name of baseByName.keys()) {
    lines.push(`| \`${name}\` | — | 🗑️ removed | — | 🗑️ removed |`);
  }

  lines.push('');
  if (!baseline) {
    lines.push('_No baseline from `main` was available; sizes are reported without deltas._');
  } else {
    lines.push(
      `_Tarball = \`npm pack\` gzipped size. ⚠️ over ±${WARN_PCT}%, 🚨 fails CI over +${FAIL_PCT}% and +${formatBytes(FAIL_BYTES)} (label \`size-increase-expected\` to allow)._`
    );
  }

  const markdown = lines.join('\n');
  if (commentPath) writeFileSync(commentPath, markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }
  console.log(markdown);

  if (failures.length > 0) {
    if (process.env.PACKAGE_SIZE_ALLOW_GROWTH) {
      console.log('\nGrowth over the fail threshold allowed by PACKAGE_SIZE_ALLOW_GROWTH.');
      return;
    }
    console.error('\nPackage tarball growth over the fail threshold:');
    for (const f of failures) {
      console.error(`  ✗ ${f.name}: ${formatDelta(f.tarballDelta, f.base)}`);
    }
    console.error(
      `\nThreshold: +${FAIL_PCT}% and +${formatBytes(FAIL_BYTES)}. If the increase is intended,`
    );
    console.error('add the `size-increase-expected` label to the PR and re-run the job.');
    process.exit(1);
  }
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1];
}

const comparePath = argValue('--compare');
if (comparePath) {
  const baselinePath = argValue('--baseline');
  if (!baselinePath) {
    console.error('--compare requires --baseline <file>.');
    process.exit(1);
  }
  compare(comparePath, baselinePath, argValue('--comment'));
} else {
  const results = measure();
  printTable(results);
  const outPath = argValue('--out');
  if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
    console.log(`\nReport written to ${outPath}`);
  }
}

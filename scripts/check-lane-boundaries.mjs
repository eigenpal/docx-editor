// Per-lane TypeScript project boundaries (task 10.1).
//
// The lane DAG says which environment each lane may assume. Before section 10 that was
// enforced by construction: each neutral package had its own tsconfig whose `lib` omitted
// DOM, so `document` in the store lane was a compile error. Collapsing eight packages into
// one destroyed that, because the browser lanes genuinely need DOM in the shared config.
//
// This restores it. Each runtime-neutral lane carries its own tsconfig with a DOM-free `lib`,
// and this script compiles each one. A text scan can be argued with; a compiler cannot.
//
// `contracts` is deliberately NOT in this list. It is declaration-only and its public API
// names HTMLElement for host-element accessors — a type reference, not a runtime dependency.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = join(ROOT, 'packages', 'core');
const BASELINE = new Set(
  readFileSync(join(ROOT, 'scripts', 'lane-boundaries-baseline.txt'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
);

/** Lanes whose RUNTIME must not assume a DOM. Kept in step with the lane DAG. */
const NEUTRAL_LANES = ['store', 'layout'];

function normalizeDiagnostic(line) {
  return line.replace(/\(\d+,\d+\)/, '').trim();
}

function layoutBindingImports() {
  const result = spawnSync('rg', ['-l', "core-contract/binding|/binding/", join(CORE, 'src', 'layout')], {
    encoding: 'utf8',
  });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr || 'rg failed while scanning layout lane imports');
  }
  return (result.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.ts') && !line.includes('__tests__'));
}

let failed = 0;
for (const lane of NEUTRAL_LANES) {
  const project = join('src', lane, 'tsconfig.json');
  if (!existsSync(join(CORE, project))) {
    console.error(`FAIL ${lane}: no ${project}. A neutral lane without its own project has no boundary.`);
    failed += 1;
    continue;
  }
  const result = spawnSync('bunx', ['tsc', '--noEmit', '-p', project], {
    cwd: CORE,
    encoding: 'utf8',
  });
  const diagnostics = `${result.stdout ?? ''}${result.stderr ?? ''}`
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /error TS\d+:/.test(line));
  const newDiagnostics = diagnostics.filter((line) => !BASELINE.has(normalizeDiagnostic(line)));
  if (newDiagnostics.length === 0) {
    console.log(`ok   ${lane} (DOM-free${diagnostics.length ? ', baseline-only diagnostics' : ''})`);
    continue;
  }
  failed += 1;
  console.error(`FAIL ${lane}`);
  console.error(newDiagnostics.join('\n'));
}

const bindingImports = layoutBindingImports();
if (bindingImports.length > 0) {
  failed += 1;
  console.error('FAIL layout: binding lane import(s) detected');
  for (const file of bindingImports) console.error(file);
}

if (failed > 0) {
  console.error(`\n${failed} lane boundary check(s) failed.`);
  process.exit(1);
}
console.log(`\n${NEUTRAL_LANES.length} neutral lanes compile without the DOM lib.`);

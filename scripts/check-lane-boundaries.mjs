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

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'core');

/** Lanes whose RUNTIME must not assume a DOM. Kept in step with the lane DAG. */
const NEUTRAL_LANES = ['store', 'layout', 'automation', 'collaboration'];

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
  if (result.status === 0) {
    console.log(`ok   ${lane} (DOM-free)`);
    continue;
  }
  failed += 1;
  console.error(`FAIL ${lane}`);
  console.error(`${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd());
}

if (failed > 0) {
  console.error(`\n${failed} lane boundary check(s) failed.`);
  process.exit(1);
}
console.log(`\n${NEUTRAL_LANES.length} neutral lanes compile without the DOM lib.`);

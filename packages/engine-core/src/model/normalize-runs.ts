// Deterministic run normalization (a core model primitive, document-engine task 4.6 /
// comprehensive 3.2 "normalization"). Merges adjacent runs with identical props and drops
// anonymous empty runs, keeping run ids where set. Pure and idempotent: equivalent converged
// inputs produce byte-equivalent run lists. Lives in the model layer so BOTH the transactional
// store (normalize-on-commit) and the preservation hasher (normalize-before-baseline-hash, so a
// normalized-but-untouched block never appears edited) share ONE definition.

import { canonicalize } from '../comparators/index.ts';
import type { RunRecord } from './authored-model.ts';

function sameProps(a: RunRecord, b: RunRecord): boolean {
  // Two runs merge only if BOTH their modeled props AND their verbatim rPr capsule match — a run
  // carrying an ownership-scoped rPr must never merge into a differently-formatted neighbour.
  return canonicalize(a.props ?? null) === canonicalize(b.props ?? null) && (a.rPrCapsule ?? '') === (b.rPrCapsule ?? '');
}

/** Merge adjacent identical-prop runs and drop empty runs (keeping run ids where set). */
export function normalizeRuns(runs: readonly RunRecord[]): RunRecord[] {
  const out: RunRecord[] = [];
  for (const run of runs) {
    if (run.text.length === 0 && run.id === undefined) continue; // drop anonymous empty run
    const last = out[out.length - 1];
    if (last && last.id === undefined && run.id === undefined && sameProps(last, run)) {
      out[out.length - 1] = { ...last, text: last.text + run.text };
    } else {
      out.push(run);
    }
  }
  return out;
}

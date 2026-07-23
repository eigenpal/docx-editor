// Deterministic normalization + repair (document-engine task 4.6). Rules are
// idempotent and order-free so equivalent converged inputs produce byte-equivalent
// normalized authored state: adjacent runs with identical props merge, empty runs
// drop, and a story is never left with zero blocks. Identity is preserved (no id
// is minted or dropped here).

import {
  type PackageModel,
  type ParagraphRecord,
  type RunRecord,
  type Story,
} from '../model/index.ts';
import { canonicalize } from '../comparators/index.ts';

function sameProps(a: RunRecord, b: RunRecord): boolean {
  return canonicalize(a.props ?? null) === canonicalize(b.props ?? null);
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

function normalizeParagraph(p: ParagraphRecord): ParagraphRecord {
  const runs = normalizeRuns(p.runs);
  return runs.length === p.runs.length && runs.every((r, i) => r === p.runs[i]) ? p : { ...p, runs };
}

/** Normalize every story's paragraphs; guarantee each story keeps at least one block. */
export function normalize(model: PackageModel): PackageModel {
  let changed = false;
  const stories = new Map(model.stories);
  for (const [storyId, story] of model.stories) {
    const blocks = story.blocks.map((b) => normalizeParagraph(b as ParagraphRecord));
    const same = blocks.length === story.blocks.length && blocks.every((b, i) => b === story.blocks[i]);
    if (!same) {
      const next: Story = { ...story, blocks };
      stories.set(storyId, next);
      changed = true;
    }
  }
  return changed ? { ...model, stories } : model;
}

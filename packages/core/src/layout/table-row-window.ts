// A whole-table pass over rows, run again only around the rows that changed.
//
// The content border pass resolves each row against its neighbors and against the vertical
// merges that run through it. When a structure read hands it the rows of an earlier read by
// identity (`table-structure-rows.ts`), only the rows near a changed row can resolve
// differently. This pass runs over a window around them and keeps the earlier results
// elsewhere, so a row edit costs the rows it changes, not the table.
//
// The window holds `RADIUS` rows of context on each side, and its edges fall on rows that
// continue no merge, so no merge crosses an edge. A context row resolves as the table's first
// or last row and is discarded. The table's own first and last rows are never context.

import type { SemanticTableRow } from './semantic-table.ts';
import { noteRowWindow, tableRowReuseEnabled } from './table-structure-rows.ts';

/** Rows of context on each side of the changed rows. */
const RADIUS = 2;

interface Pass {
  readonly inputs: readonly (readonly SemanticTableRow[])[];
  readonly params: string;
  readonly output: readonly SemanticTableRow[];
}

/** One whole-table row pass whose earlier results can be reused. */
export interface RowWindowPass {
  /**
   * `compute(start, end)` resolves rows `[start, end)` of `inputs` as a table of those rows
   * alone. Every array in `inputs` has one entry per row; `params` names everything else the
   * pass reads. Earlier runs are kept under `owner`, the table's stable properties node, so
   * they go when the document goes.
   */
  run(
    owner: object,
    inputs: readonly (readonly SemanticTableRow[])[],
    params: string,
    compute: (start: number, end: number) => readonly SemanticTableRow[]
  ): readonly SemanticTableRow[];
}

const continuesMerge = (row: SemanticTableRow | undefined): boolean =>
  row !== undefined && row.cells.some((cell) => cell.vMergeContinue);

/** A pass that keeps its last run per table. */
export function rowWindowPass(): RowWindowPass {
  const runs = new WeakMap<object, Pass[]>();
  return {
    run(owner, inputs, params, compute) {
      const passes = runs.get(owner) ?? [];
      // One run per table: a row edit compares with the read before it.
      const remember = (pass: Pass): void => {
        if (tableRowReuseEnabled()) runs.set(owner, [pass]);
      };
      const rows = inputs[0]!;
      const count = rows.length;
      let best: { pass: Pass; prefix: number; suffix: number } | undefined;
      if (tableRowReuseEnabled())
        for (const pass of passes) {
          if (pass.params !== params || pass.inputs.length !== inputs.length) continue;
          const before = pass.inputs[0]!.length;
          const limit = Math.min(count, before);
          const same = (at: number, then: number) =>
            inputs.every((input, which) => input[at] === pass.inputs[which]![then]);
          let prefix = 0;
          while (prefix < limit && same(prefix, prefix)) prefix += 1;
          let suffix = 0;
          while (suffix < limit - prefix && same(count - 1 - suffix, before - 1 - suffix))
            suffix += 1;
          if (!best || prefix + suffix > best.prefix + best.suffix) best = { pass, prefix, suffix };
        }
      const whole = () => {
        const output = compute(0, count);
        remember({ inputs, params, output });
        return output;
      };
      // Reuse pays only when most rows are unchanged.
      if (!best || best.prefix + best.suffix < count / 2) return whole();
      const { pass, prefix, suffix } = best;
      const before = pass.inputs[0]!.length;
      if (prefix === count && before === count) {
        remember({ inputs, params, output: pass.output });
        return pass.output;
      }
      // Rows whose context reaches a changed row, widened to whole merges.
      let start = Math.max(0, prefix - RADIUS);
      let end = Math.min(count, count - suffix + RADIUS);
      while (start > 0 && continuesMerge(rows[start])) start -= 1;
      while (end < count && continuesMerge(rows[end])) end += 1;
      // Their context, also widened so no merge crosses the window's edges.
      let from = Math.max(0, start - RADIUS);
      let to = Math.min(count, end + RADIUS);
      while (from > 0 && continuesMerge(rows[from])) from -= 1;
      while (to < count && continuesMerge(rows[to])) to += 1;
      const window = compute(from, to);
      noteRowWindow();
      const shift = before - count;
      const output: SemanticTableRow[] = [];
      for (let at = 0; at < start; at += 1) output.push(pass.output[at]!);
      for (let at = start; at < end; at += 1) output.push(window[at - from]!);
      for (let at = end; at < count; at += 1) output.push(pass.output[at + shift]!);
      remember({ inputs, params, output });
      return output;
    },
  };
}

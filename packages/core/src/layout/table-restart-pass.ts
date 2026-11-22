// One body flow pass that restarts a changed table at a kept page (`table-page-restart.ts`).
//
// The body flow (`semantic-layout.ts`) asks for a plan once, resumes from the plan's checkpoint,
// and hands the restarted table to `run`. The pass holds the rest: the resume goes to the first
// table pagination only, a paginator that refuses the resume gives the flow back to the
// checkpoint before the table, and the table's cell break keys join the kept pages' keys.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { FlowCheckpoint } from './layout-session.ts';
import type { LayoutSteps } from './layout-steps.ts';
import type { PreparedBlock } from './section-prepass-types.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';
import type { PageRecord } from './semantic-records.ts';
import type { TableFlowPlacementResult } from './table-flow-cursor.ts';
import {
  noteRestartFallback,
  registerRestartedTableKeys,
  tablePageRestart,
  type TableRestartPlan,
  type TableResume,
} from './table-page-restart.ts';

/** The table cell break key collector of the body flow (`createTableCellBreakKeyCollector`). */
interface KeyCollector {
  begin(): void;
  keys(): readonly string[];
  end(): void;
}

export interface TableRestartPass {
  /** The body flow checkpoint to resume from: the top of the restart page. */
  readonly checkpoint: FlowCheckpoint;
  /**
   * The resume for the next table pagination, once, with the cell break keys the kept pages
   * hold before it. Every other pagination counts its keys from 0.
   */
  takeResume(): { readonly resume?: TableResume; readonly keyBase: number };
  /** The checkpoint before block `index`: the previous pass's for the restarted table. */
  checkpointAt(index: number, now: () => FlowCheckpoint): FlowCheckpoint;
  /**
   * Paginate block `index` from the kept page when it is the restarted table. False when it is
   * not, or when the paginator refused the resume and the flow is back before the table.
   */
  run(
    table: OoxmlElement,
    index: number,
    paginate: () => LayoutSteps<TableFlowPlacementResult>
  ): LayoutSteps<boolean>;
}

/** What the body flow gives a restart: the previous pass, the table's reader, and its hooks. */
export interface TableRestartInput {
  readonly prepared: readonly PreparedBlock[];
  /** The first changed block of the pass. */
  readonly index: number;
  readonly checkpoints: readonly FlowCheckpoint[];
  readonly pages: readonly PageRecord[];
  readonly width: number;
  readonly deps: TableFlowDeps;
  /** The block the previous pass laid out at `index`. */
  readonly previous: PreparedBlock | undefined;
  readonly keys: KeyCollector;
  /** Columns of the section. A page start is recorded per page, not per column. */
  readonly columnCount: number;
  /** Restore the body flow to `checkpoint`, keeping the previous pass's pages before it. */
  readonly resumeFrom: (checkpoint: FlowCheckpoint) => void;
  /** The restarted table placed: the flow after it starts as after any table. */
  readonly placed: () => void;
}

let failAfterResumeForTests: 'throw' | 'refuse' | undefined;
let warned = false;

/**
 * Says once per process that a table restart failed and the whole table was paginated, as other
 * layout fallbacks do (`unsettled-exclusion-layout.ts`). The layout is right either way, so this
 * reports an engine defect to fix. It names only the error's class and code, never document
 * content or node ids.
 */
function warnRestartFallbackOnce(error: unknown): void {
  if (warned) return;
  warned = true;
  const name = error instanceof Error ? error.name : typeof error;
  const code =
    error !== null && typeof error === 'object' && 'code' in error
      ? ` (${String(error.code)})`
      : '';
  console.warn(
    `[docx-editor] A table edit could not restart its pagination at a kept page and paginated ` +
      `the whole table instead: ${name}${code}. The layout is correct; please report this.`
  );
}

/**
 * @internal Make every restart fail after it paginated: it throws, or the paginator refuses the
 * resume. Tests prove the fallback to a whole pagination with it. Returns the restore.
 */
export function failTableRestartsForTests(how: 'throw' | 'refuse'): () => void {
  failAfterResumeForTests = how;
  warned = false;
  return () => {
    failAfterResumeForTests = undefined;
  };
}

/** A restart of the first changed block of the pass, or null when it paginates as usual. */
export function planTableRestartPass(input: TableRestartInput): TableRestartPass | null {
  if (input.columnCount !== 1) return null;
  const plan: TableRestartPlan | null = tablePageRestart(
    input.prepared,
    input.index,
    input.checkpoints,
    input.pages,
    { width: input.width, deps: input.deps, previous: input.previous }
  );
  if (!plan) return null;
  input.resumeFrom(plan.checkpoint);
  let pending = true;
  return {
    checkpoint: plan.checkpoint,
    takeResume() {
      if (!pending) return { keyBase: 0 };
      pending = false;
      return { resume: plan.resume, keyBase: plan.breakKeys };
    },
    checkpointAt: (index, now) => (index === input.index ? input.checkpoints[index]! : now()),
    *run(table, index, paginate) {
      if (index !== input.index || !pending) return false;
      input.keys.begin();
      try {
        let refused: boolean;
        try {
          refused = (yield* paginate()).restartRefused === true;
          if (failAfterResumeForTests === 'throw') throw new Error('restart failure for tests');
          refused ||= failAfterResumeForTests === 'refuse';
        } catch (error) {
          // A last safety net: a restart that fails where the whole table may not paginates
          // the whole table again. The flow before the table is restored below.
          refused = true;
          noteRestartFallback();
          warnRestartFallbackOnce(error);
        }
        if (refused) {
          plan.restoreBudgets();
          input.resumeFrom(input.checkpoints[index]!);
        } else {
          input.placed();
          registerRestartedTableKeys(table, input.previous, plan, input.keys.keys());
        }
        return !refused;
      } finally {
        input.keys.end();
      }
    },
  };
}

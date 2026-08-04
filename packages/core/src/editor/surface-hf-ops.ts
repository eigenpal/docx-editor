// Header/footer lifecycle + page-field commits for the paginated surface.
//
// Keeps package-level furniture ops and allowlisted field insertion off the composition
// root so paginated-surface stays under the max-lines budget.

import type { TreeDocxSession } from '@docx-editor.dev/core-contract/binding';
import type { SemanticSelection } from '@docx-editor.dev/core-contract/layout';
import type { TreeDocOp } from '@docx-editor.dev/core-contract/store';
import type { SurfaceLifecycleOp } from './surface-hf-editing.ts';

export function createHeaderFooterOps(deps: {
  applyOps: (
    ops: readonly TreeDocOp[],
    before?: { paragraphId: string; start: number; end: number } | null,
    after?: { paragraphId: string; start: number; end: number } | null
  ) => ReturnType<TreeDocxSession['applyTreeOps']>;
  commit: (
    run: () => ReturnType<TreeDocxSession['applyTreeOps']> | boolean,
    selectionAfter?: () => SemanticSelection | null
  ) => void;
  deleteSelectionOps: () => readonly TreeDocOp[];
  orderedStart: () => { paragraphId: string; offset: number };
  selectionMark: () => { paragraphId: string; start: number; end: number } | null;
  collapsedAt: (pos: { paragraphId: string; offset: number }) => SemanticSelection;
  isHeaderFooterOpen: () => boolean;
  lastRejection: () => string | null;
}): {
  applyHeaderFooterLifecycle: (
    op: SurfaceLifecycleOp
  ) => { readonly ok: true } | { readonly ok: false; readonly reason: string };
  insertPageField: (field: 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES' | 'PAGE_X_OF_Y') => boolean;
} {
  return {
    applyHeaderFooterLifecycle(op) {
      let refused: string | null = null;
      deps.commit(() => {
        const result = deps.applyOps([op]);
        if (result.rejected) refused = String(result.reason ?? 'rejected');
        return result;
      });
      return refused ? { ok: false as const, reason: refused } : { ok: true as const };
    },

    insertPageField(field) {
      if (!deps.isHeaderFooterOpen()) return false;
      const start = deps.orderedStart();
      deps.commit(
        () =>
          deps.applyOps(
            [
              ...deps.deleteSelectionOps(),
              {
                op: 'insertPageField',
                paragraphId: start.paragraphId,
                offset: start.offset,
                field,
              },
            ],
            deps.selectionMark()
          ),
        () =>
          deps.collapsedAt({
            paragraphId: start.paragraphId,
            offset: start.offset + (field === 'PAGE_X_OF_Y' ? 1 + ' of '.length + 1 : 1),
          })
      );
      return deps.lastRejection() === null;
    },
  };
}

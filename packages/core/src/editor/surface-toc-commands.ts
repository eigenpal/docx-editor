// Table of contents commands that need no layout: whether a refresh can run, and removal.
//
// Removal is one store op that takes the field, or the table of contents control around it,
// out whole. The text before and after the field stays.

import type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { SemanticPosition } from '@docx-editor.dev/core/layout';
import {
  validateTreeOp,
  type DetectedToc,
  type SelectionMark,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import { resolveTocSources } from '../store/package/toc-sources.ts';
import type { SurfaceEditingMode } from './paginated-surface-contract.ts';

export interface TocCommandDeps {
  readonly session: Pick<
    TreeDocxSessionView,
    'part' | 'documentOutline' | 'editable' | 'subscribe'
  >;
  readonly editingMode: () => SurfaceEditingMode;
  /** The addressed table of contents, or the one at the right-click or the caret. */
  readonly target: (tocId?: string) => DetectedToc | null;
  /** Why the surface would refuse these ops now, or null. */
  readonly writeRefusal: (ops: readonly TreeDocOp[]) => string | null;
  /** Commit body ops as one undo step. */
  readonly apply: (ops: readonly TreeDocOp[]) => TreeApplyResult;
  /** Called after a removal commits: the table of contents is gone, so is its menu. */
  readonly removed: () => void;
  /** Put the caret where the table of contents was. */
  readonly select: (at: SemanticPosition) => void;
  /** Publish a refusal, with a reason the user reads. */
  readonly refuse: (reason: string, raw: string) => void;
}

/** Why a table of contents cannot be removed: none is addressed, or it cannot go now. @public */
export interface TocRemovalRefusal {
  readonly code: 'notFound' | 'unsupported';
  readonly reason: string;
}

const NO_TOC = 'there is no table of contents to remove';
const CANNOT_REMOVE = 'the table of contents cannot be removed';

/** Store rejections, reworded for the user. */
const REMOVAL_REFUSALS: Readonly<Record<string, string>> = {
  locked: 'the table of contents is locked',
  bound: 'the table of contents is bound to data',
  'carries-section-mark': 'the table of contents holds a section break',
  'not-a-block': 'the table of contents holds a table or a content control',
};

export function createTocCommands(deps: TocCommandDeps) {
  function canRefreshToc(tocId?: string): boolean {
    if (deps.editingMode() === 'view' || !deps.session.editable) return false;
    const toc = deps.target(tocId);
    if (
      !toc ||
      !resolveTocSources(deps.session.part(), deps.session.documentOutline(), toc.instruction)
    )
      return false;
    const op: TreeDocOp = { op: 'rewriteTocPageNumbers', tocId: toc.id, updates: [] };
    return validateTreeOp(deps.session.part(), op) === null;
  }

  /** The removal op and why it cannot run, if it cannot. */
  function removal(tocId?: string): { op?: TreeDocOp; refusal: TocRemovalRefusal | null } {
    const toc = deps.target(tocId);
    if (!toc) return { refusal: { code: 'notFound', reason: NO_TOC } };
    const op: TreeDocOp = { op: 'removeToc', tocId: toc.id };
    const rejection = validateTreeOp(deps.session.part(), op);
    const reason = rejection
      ? (REMOVAL_REFUSALS[rejection] ?? CANNOT_REMOVE)
      : deps.writeRefusal([op]);
    return { op, refusal: reason ? { code: 'unsupported', reason } : null };
  }

  function removeTocRefusal(tocId?: string): TocRemovalRefusal | null {
    if (!deps.session.editable) return { code: 'unsupported', reason: CANNOT_REMOVE };
    return removal(tocId).refusal;
  }

  /** Remove the addressed table of contents; false, with a published refusal, when it cannot. */
  function removeToc(tocId?: string): boolean {
    const { op, refusal } = removal(tocId);
    if (!op || refusal) {
      deps.refuse(refusal?.reason ?? CANNOT_REMOVE, 'table-of-contents-refused');
      return false;
    }
    // The store names where the cut was; the caret goes there, as after a deletion.
    let caret: SelectionMark | undefined;
    const stop = deps.session.subscribe((change) => {
      if (change.caret) caret = change.caret;
    });
    let applied: TreeApplyResult;
    try {
      applied = deps.apply([op]);
    } finally {
      stop();
    }
    if (!applied.committed) {
      const reason = applied.reason ?? CANNOT_REMOVE;
      deps.refuse(REMOVAL_REFUSALS[reason] ?? reason, reason);
      return false;
    }
    if (caret) deps.select({ paragraphId: caret.paragraphId, offset: caret.start });
    deps.removed();
    return true;
  }

  return { canRefreshToc, removal: { removeTocRefusal, removeToc } };
}

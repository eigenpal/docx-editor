import { normalizeCollaborationTextPackage } from '../collaboration/document-port.ts';
import { runWithTransactionActor } from '../store/package/actor-scoped-ids.ts';
import { isHeaderFooterLifecycleOp } from '../store/package/hf-lifecycle.ts';
import { isNoteLifecycleOp } from '../store/package/note-lifecycle.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { TreePackageStore, StoryScope } from '../store/store/tree-package-store.ts';
import type { SelectionMark } from '../store/store/tree-store.ts';
import type { TreeApplyOptions, TreeApplyResult } from './tree-session.ts';

const EMPTY_APPLY: TreeApplyResult = { committed: false, rejected: false, opCount: 0 };

function refused(opCount: number, reason?: string): TreeApplyResult {
  return reason === undefined
    ? { committed: false, rejected: true, opCount }
    : { committed: false, rejected: true, opCount, reason };
}

export function commitSessionTreeOps(
  packageStore: TreePackageStore,
  ops: readonly TreeDocOp[],
  selectionBefore: SelectionMark | null | undefined,
  selectionAfter: SelectionMark | null | undefined,
  scope: StoryScope,
  options: TreeApplyOptions
): TreeApplyResult {
  if (ops.length === 0) return EMPTY_APPLY;
  const lifecycleCount = ops.filter(
    (op) => isHeaderFooterLifecycleOp(op) || isNoteLifecycleOp(op)
  ).length;
  if (lifecycleCount > 0) {
    if (lifecycleCount !== ops.length || ops.length !== 1) {
      return refused(ops.length, 'invalidArgs');
    }
    const result = runWithTransactionActor(options.actorId, () =>
      packageStore.applyLifecycleOp(ops[0]!)
    );
    if (!result.ok) return refused(1, result.detail ?? result.reason);
    return { committed: true, rejected: false, opCount: 1 };
  }
  const partName =
    options.recordsHistory === false && options.actorId && options.operationId
      ? packageStore.partFor(scope)?.name
      : undefined;
  const result = packageStore.transact(
    scope,
    (ctx) => {
      if (selectionBefore !== undefined) ctx.selectionBefore(selectionBefore);
      if (selectionAfter !== undefined) ctx.selectionAfter(selectionAfter);
      for (const op of ops) ctx.apply(op);
      if (partName) {
        ctx.applyPackage((pkg) => normalizeCollaborationTextPackage(pkg, partName, ops));
      }
    },
    options
  );
  if (!result.ok) return refused(ops.length, result.reason);
  return { committed: true, rejected: false, opCount: ops.length };
}

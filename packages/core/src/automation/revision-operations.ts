import type { PlannedOperation } from './plan-types.ts';
import { revisionItemsOf } from '../store/store/review-reads.ts';
import { planRevisionBatch, type RevisionBatchResult } from '../store/store/revision-batch.ts';
import { storyKey } from './stories.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { AutomationErrorCode } from './protocol.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import { storyOfHandle } from './spans.ts';

type CollectionDecision = Extract<
  AutomationOperation,
  { readonly op: 'acceptAllRevisions' | 'rejectAllRevisions' }
>;

type DecisionTarget =
  | { readonly ok: true; readonly reads: AutomationStoryReads }
  | {
      readonly ok: false;
      readonly code: AutomationErrorCode;
      readonly message: string;
      readonly detail?: string;
    };

/** Resolve either the compatible document form or the story-scoped body form. */
export function revisionDecisionTarget(
  operation: CollectionDecision,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads
): DecisionTarget {
  if ('body' in operation) {
    const story = storyOfHandle(operation.body, 'body', handles, packageReads);
    return story.ok
      ? { ok: true, reads: story.value }
      : {
          ok: false,
          code: story.code,
          message: 'that handle does not name a body',
          detail: story.detail,
        };
  }
  if (!handles.resolve(operation.document, 'document')) {
    return {
      ok: false,
      code: 'invalid-handle',
      message: 'that handle does not name a document',
      detail: 'document',
    };
  }
  return packageReads.body
    ? { ok: true, reads: packageReads.body }
    : {
        ok: false,
        code: 'document-unavailable',
        message: 'this host holds no document',
      };
}

/**
 * Build one atomic collection decision after its target story has been resolved.
 *
 * A header, footer, or the main body owns its part, so the store's part-wide op is the decision.
 * Notes share `footnotes.xml` / `endnotes.xml`, so one exact canonical note root scopes the same
 * store-level all-decision. Listing identities never participate in collection mutation.
 */
export function revisionCollectionOps(
  operation: CollectionDecision,
  reads: AutomationStoryReads
): readonly TreeDocOp[] {
  const accept = operation.op === 'acceptAllRevisions';
  const scope = reads.story.kind === 'note' ? { scopeRootId: reads.root.id } : {};
  return [accept ? { op: 'acceptAllRevisions', ...scope } : { op: 'rejectAllRevisions', ...scope }];
}

/** Resolve handles once, then plan the selected sites together. Unknown host handles fail closed. */
export function revisionBatchPlan(
  operation: Extract<AutomationOperation, { op: 'resolveRevisionBatch' }>,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads
) {
  const target = revisionDecisionTarget(
    { op: 'acceptAllRevisions', body: operation.body },
    handles,
    packageReads
  );
  if (!target.ok) return target;
  if (
    !['accept', 'reject'].includes(operation.action) ||
    (operation.revisions !== undefined && !Array.isArray(operation.revisions))
  )
    return {
      ok: false as const,
      code: 'unsupported-content' as const,
      message: 'invalid revision batch',
    };
  const keys: string[] | undefined = operation.revisions === undefined ? undefined : [];
  for (const handle of operation.revisions ?? []) {
    const revision = handles.resolve(handle, 'revision');
    if (
      !revision ||
      revision.kind !== 'revision' ||
      storyKey(revision.story) !== storyKey(target.reads.story)
    )
      return {
        ok: false as const,
        code: 'invalid-handle' as const,
        message: 'revision does not belong to this story',
      };
    keys!.push(`revision-${revision.revisionId}`);
  }
  const plan = planRevisionBatch(
    target.reads.part,
    operation.action,
    keys,
    target.reads.story.kind === 'note' ? target.reads.root : undefined
  );
  return { ok: true as const, reads: target.reads, ...plan };
}

/** Count pending decisions after mutation, when adjacent surviving changes may regroup. */
export function revisionBatchAnswer(
  body: import('./protocol.ts').AutomationHandle,
  result: RevisionBatchResult,
  handles: AutomationHandleTable,
  post: AutomationPackageReads
): import('./protocol.ts').AutomationValue {
  const target = revisionDecisionTarget({ op: 'acceptAllRevisions', body }, handles, post);
  if (!target.ok) throw new Error('resolved story disappeared');
  const { part, root, story } = target.reads;
  const remaining = revisionItemsOf(
    story.kind === 'note' && root.kind !== 'textValue' ? { ...part, root } : part
  ).length;
  return { kind: 'revisionBatch', result: { ...result, remaining } };
}

/** Share story admission between strict collection decisions and selected-set decisions. */
export function planRevisionDecision(
  operation: CollectionDecision | Extract<AutomationOperation, { op: 'resolveRevisionBatch' }>,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads,
  pin: (story: AutomationStoryReads) => PlannedOperation | null
): PlannedOperation {
  if (operation.op === 'resolveRevisionBatch') {
    const target = revisionBatchPlan(operation, handles, reads);
    if (!target.ok) return { ok: false, error: { code: target.code, message: target.message } };
    const conflict = pin(target.reads);
    if (conflict) return conflict;
    return {
      ok: true,
      kind: 'command',
      story: target.reads.story,
      ops: target.ops,
      answer: (post) => revisionBatchAnswer(operation.body, target.result, handles, post),
    };
  }
  const target = revisionDecisionTarget(operation, handles, reads);
  if (!target.ok)
    return {
      ok: false,
      error: { code: target.code, message: target.message, detail: target.detail },
    };
  const conflict = pin(target.reads);
  if (conflict) return conflict;
  return {
    ok: true,
    kind: 'command',
    story: target.reads.story,
    ops: revisionCollectionOps(operation, target.reads),
    answer: () => ({ kind: 'applied' }),
  };
}

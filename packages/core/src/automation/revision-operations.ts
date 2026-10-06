import { sharesItsPart } from './stories.ts';
import { collectRevisionSites } from '../store/store/tree-op-revisions.ts';
import { reviewItemKey, type ReviewRevisionItem } from '../store/store/review-items.ts';
import type { PlannedOperation } from './plan-types.ts';
import { planRevisionBatch, type RevisionBatchResult } from '../store/store/revision-batch.ts';
import { storyKey } from './stories.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { AutomationErrorCode } from './protocol.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import { storyOfHandle } from './spans.ts';
import { revisionItemsInStory } from './review.ts';
import { textboxSiteIndex } from './textbox-revision-scope.ts';

/** The store's bound on one decision's explicit site list (`tree-op-validate.ts`). */
const MAX_SITES_PER_OP = 50_000;

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
 * store-level all-decision, and a text box story is scoped to its own `w:txbxContent` the same
 * way. Its owner's decision names its own sites so it leaves the boxes it anchors alone.
 * Listing identities never participate in collection mutation.
 */
export function revisionCollectionOps(
  operation: CollectionDecision,
  reads: AutomationStoryReads
): readonly TreeDocOp[] {
  if (
    reads.root.kind !== 'textValue' &&
    collectRevisionSites({ ...reads.part, root: reads.root }).length === 0
  )
    return [];
  const op = operation.op;
  const index = textboxSiteIndex(reads.part);
  const sites = () => collectRevisionSites(reads.part).map((site) => site.node.id);
  // The store takes a bounded site list per op; one transaction still makes it one decision.
  const chunked = (ids: readonly string[]): TreeDocOp[] => {
    const ops: TreeDocOp[] = [];
    for (let start = 0; start < ids.length; start += MAX_SITES_PER_OP) {
      ops.push({ op, siteNodeIds: ids.slice(start, start + MAX_SITES_PER_OP) });
    }
    return ops;
  };
  if (reads.story.kind === 'textbox') {
    // The VML copy carries the same changes; deciding them together keeps the copies alike.
    const root = reads.root.id;
    const copy = index.copy.size
      ? sites().filter((id) => index.copy.has(id) && index.story.get(id) === root)
      : [];
    return [{ op, scopeRootId: root }, ...chunked(copy)];
  }
  if (sharesItsPart(reads.story)) return [{ op, scopeRootId: reads.root.id }];
  if (index.story.size === 0) return [{ op }];
  const all = sites();
  const own = all.filter((id) => !index.story.has(id));
  return own.length === all.length ? [{ op }] : chunked(own);
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
  // Every decision of the story. An owner story names its own, so the boxes it anchors stay.
  let keys: string[] | undefined = operation.revisions === undefined ? undefined : [];
  if (
    keys === undefined &&
    !sharesItsPart(target.reads.story) &&
    textboxSiteIndex(target.reads.part).story.size > 0
  )
    keys = revisionItemsInStory(target.reads).map(reviewItemKey);
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
    sharesItsPart(target.reads.story) ? target.reads.root : undefined
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
  const remaining = revisionItemsInStory(target.reads).length;
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

/** Resolve only this decision's source sites, with shared dependency preflight. */
export function revisionItemOps(
  reads: AutomationStoryReads,
  item: ReviewRevisionItem,
  action: 'accept' | 'reject'
): readonly TreeDocOp[] {
  const decision = planRevisionBatch(
    reads.part,
    action,
    [reviewItemKey(item)],
    sharesItsPart(reads.story) ? reads.root : undefined
  );
  return decision.result.skipped.length ? [] : decision.ops;
}

import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { AutomationErrorCode } from './protocol.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import { revisionDecisionOps } from './review.ts';
import { storyOfHandle } from './spans.ts';

type CollectionDecision = Extract<
  AutomationOperation,
  { readonly op: 'acceptAllRevisions' | 'rejectAllRevisions' }
>;

type DecisionTarget =
  | { readonly ok: true; readonly reads: AutomationStoryReads; readonly storyScoped: boolean }
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
      ? { ok: true, reads: story.value, storyScoped: true }
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
    ? { ok: true, reads: packageReads.body, storyScoped: false }
    : {
        ok: false,
        code: 'document-unavailable',
        message: 'this host holds no document',
      };
}

/** Build one atomic collection decision after its target story has been resolved. */
export function revisionCollectionOps(
  operation: CollectionDecision,
  reads: AutomationStoryReads,
  storyScoped: boolean
): readonly TreeDocOp[] | null {
  if (storyScoped) {
    return revisionDecisionOps(reads, operation.op === 'acceptAllRevisions');
  }
  return [
    operation.op === 'acceptAllRevisions'
      ? { op: 'acceptAllRevisions' }
      : { op: 'rejectAllRevisions' },
  ];
}

// Tracked inline planning shares the canonical story transaction and snapshot anchors.
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import type { AutomationErrorCode } from './protocol.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import { resolveSpanRef, storyOfSpanRef, spanValue, type ResolvedRange } from './spans.ts';
import { proposalInputError, proposalRevisionError } from './proposals.ts';

export function planProposal(
  operation: Extract<
    AutomationOperation,
    { op: 'proposeInsertion' | 'proposeDeletion' | 'proposeReplacement' }
  >,
  tracked: boolean,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads,
  claim: (story: AutomationStoryReads, paragraphId: string) => PlannedOperation | null
): PlannedOperation {
  const refuse = (
    code: AutomationErrorCode,
    message: string,
    detail?: string
  ): PlannedOperation => ({
    ok: false,
    error: { code, message, ...(detail === undefined ? {} : { detail }) },
  });
  const spanOf = (range: ResolvedRange) => spanValue(range, handles);
  const query = (value: import('./protocol.ts').AutomationValue): PlannedOperation => ({
    ok: true,
    kind: 'query',
    value,
  });
  const inputError = proposalInputError(operation, tracked);
  if (inputError) return { ok: false, error: inputError };
  const insertion = operation.op === 'proposeInsertion';
  const deletion = operation.op === 'proposeDeletion';
  const resolved = resolveSpanRef(operation.span, handles, packageReads);
  if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
  const range = resolved.value;
  if (!range || range.start.paragraphId !== range.end.paragraphId) {
    return refuse('unsupported-content', 'proposals require a single paragraph range', 'span');
  }
  if (!tracked && !insertion && range.start.offset === range.end.offset) {
    return refuse('unsupported-content', 'deletion and replacement need a non-empty range', 'span');
  }
  const story = storyOfSpanRef(operation.span, handles, packageReads);
  if (!story.ok) return refuse(story.code, 'that story is not a place', story.detail);
  const paragraphId = range.start.paragraphId;
  const start = insertion && operation.where === 'After' ? range.end.offset : range.start.offset;
  const end = insertion ? start : range.end.offset;
  if (tracked && !deletion && start === end && operation.text === '')
    return query({ kind: 'span', span: spanOf({ start: range.start, end: range.start }) });
  const revisionError = proposalRevisionError(story.value, paragraphId, start, end);
  if (revisionError) return { ok: false, error: revisionError };
  const conflict = claim(story.value, paragraphId);
  if (conflict) return conflict;
  const revision = { author: operation.author.trim(), date: new Date().toISOString() };
  const ops: TreeDocOp[] = [];
  if (!insertion && end > start) ops.push({ op: 'deleteText', paragraphId, start, end, revision });
  if (!deletion && operation.text.length > 0)
    ops.push({
      op: 'insertText',
      paragraphId,
      offset: insertion ? start : end,
      text: operation.text,
      revision,
    });
  return {
    ok: true,
    kind: 'command',
    ops,
    story: story.value.story,
    answer: () => {
      if (!tracked) return { kind: 'applied' };
      const at = { ...range.start, offset: insertion ? start : end };
      return {
        kind: 'span',
        span: spanOf({
          start: at,
          end: { ...at, offset: at.offset + (deletion ? 0 : operation.text.length) },
        }),
      };
    },
  };
}

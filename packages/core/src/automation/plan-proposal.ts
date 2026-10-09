// Tracked inline planning shares the canonical story transaction and snapshot anchors.
import { lineBreakRefusal } from './line-break-text.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import type { AutomationErrorCode } from './protocol.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import { resolveSpanRef, storyOfSpanRef, spanValue, type ResolvedRange } from './spans.ts';
import { parentNodeOf } from '../store/package/ooxml-edit.ts';
import { proposalInputError, proposalRevisionError } from './proposals.ts';

export function planProposal(
  operation: Extract<
    AutomationOperation,
    { op: 'proposeInsertion' | 'proposeDeletion' | 'proposeReplacement' }
  >,
  tracked: boolean,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads,
  claim: (story: AutomationStoryReads, paragraphId: string) => PlannedOperation | null,
  trackedRangeReplacement = true
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
  if (range && tracked && !insertion && range.start.paragraphId !== range.end.paragraphId) {
    if (!trackedRangeReplacement)
      return refuse(
        'unsupported-capability',
        'tracked paragraph-range replacement is unsupported in collaboration',
        'span'
      );
    const story = storyOfSpanRef(operation.span, handles, packageReads);
    if (!story.ok) return refuse(story.code, 'that story is not a place', story.detail);
    const reads = story.value;
    const firstIndex = reads.indexOf(range.start.paragraphId);
    const lastIndex = reads.indexOf(range.end.paragraphId);
    const ids = reads.paragraphIds.slice(firstIndex, lastIndex + 1);
    const parent = parentNodeOf(reads.part, ids[0]!);
    const positions = ids.map((id) => parent?.children.findIndex((node) => node.id === id) ?? -1);
    if (
      !parent ||
      positions.some(
        (position, index) => position < 0 || (index > 0 && position !== positions[index - 1]! + 1)
      )
    )
      return refuse(
        'unsupported-content',
        'tracked ranges require adjacent sibling paragraphs',
        'span'
      );
    const revision = { author: operation.author.trim(), date: new Date().toISOString() };
    const ops: TreeDocOp[] = [];
    for (let index = 0; index < ids.length; index++) {
      const paragraphId = ids[index]!;
      const start = index === 0 ? range.start.offset : 0;
      const end =
        index === ids.length - 1 ? range.end.offset : (reads.rawText(paragraphId) ?? '').length;
      const error = proposalRevisionError(reads, paragraphId, start, end);
      if (error) return { ok: false, error };
      const conflict = claim(reads, paragraphId);
      if (conflict) return conflict;
      if (end > start) ops.push({ op: 'deleteText', paragraphId, start, end, revision });
      if (index < ids.length - 1)
        ops.push({ op: 'setParagraphMarkRevision', paragraphId, kind: 'del', revision });
    }
    const at = { ...range.start, offset: (reads.rawText(ids[0]!) ?? '').length };
    const text = deletion ? '' : operation.text;
    const lineBreak = lineBreakRefusal(reads.part, ids[0]!, range.start.offset, at.offset, text);
    if (lineBreak) return lineBreak;
    if (text)
      ops.push({ op: 'insertText', paragraphId: ids[0]!, offset: at.offset, text, revision });
    return {
      ok: true,
      kind: 'command',
      ops,
      story: reads.story,
      answer: () => ({
        kind: 'span',
        span: spanOf({ start: at, end: { ...at, offset: at.offset + text.length } }),
      }),
    };
  }
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
  const revisionError = proposalRevisionError(
    story.value,
    paragraphId,
    start,
    end,
    tracked && insertion ? operation.author.trim() : undefined,
    insertion && start === (story.value.rawText(paragraphId) ?? '').length,
    tracked && !insertion && end > start ? operation.author.trim() : undefined
  );
  if (revisionError) return { ok: false, error: revisionError };
  if (!deletion) {
    const lineBreak = lineBreakRefusal(story.value.part, paragraphId, start, end, operation.text);
    if (lineBreak) return lineBreak;
  }
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

/** Continuation can split an author's own text and paragraph proposals. */
export function trackedParagraphInsertError(
  story: AutomationStoryReads,
  paragraphId: string,
  author: string
) {
  return proposalRevisionError(
    story,
    paragraphId,
    0,
    (story.rawText(paragraphId) ?? '').length,
    author,
    true
  );
}

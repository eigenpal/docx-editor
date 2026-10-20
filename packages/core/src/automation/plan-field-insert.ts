// Field insertion: an inert field at a range edge, untracked or as one tracked insertion.
//
// The instruction is caller data. It is checked against the bounded allowlist in
// `inert-field-instruction.ts`, written as text, and never evaluated, so the cached result is
// empty. Untracked insertion keeps its simple-field form. Tracked insertion writes a complex
// field whose runs sit in ONE `w:ins` by the runtime author, so Accept keeps the field and
// Reject removes all of it. A simple field is never written inside a revision.

import { inertFieldInstruction } from '../store/store/inert-field-instruction.ts';
import { effectiveContentLockAt, isBoundAt } from '../store/store/tree-op-nodes.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { segmentsOf } from '../store/store/tree-op-segments.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import { tocFieldCode } from './toc-field-code.ts';
import { revisionDateNow } from './revision-date.ts';
import { fieldsInParagraph, fieldInsertionParagraph } from './fields.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan.ts';
import type { AutomationErrorCode } from './protocol.ts';
import type { AutomationStoryReads } from './reads.ts';
import type { ResolvedRange } from './spans.ts';
import { proposalRevisionError } from './proposals.ts';
import { landsInForeignInsertionContainer } from './proposal-foreign-revisions.ts';
import { ownMarkDeletionRefusal } from './plan-proposal.ts';

type InsertFieldOperation = Extract<AutomationOperation, { op: 'insertField' }>;

/** Office field types and the instruction word each writes. */
const FIELD_TYPE_WORDS: Readonly<Record<string, string>> = {
  Page: 'PAGE',
  NumPages: 'NUMPAGES',
  Ref: 'REF',
  PageRef: 'PAGEREF',
  NoteRef: 'NOTEREF',
  Seq: 'SEQ',
  StyleRef: 'STYLEREF',
  Date: 'DATE',
  Time: 'TIME',
};

const refuse = (code: AutomationErrorCode, message: string, detail?: string): PlannedOperation => ({
  ok: false,
  error: { code, message, ...(detail === undefined ? {} : { detail }) },
});

/** Field types and instructions this lane writes. Every other one refuses with this. */
const fieldUnsupported = (message: string) =>
  refuse('unsupported-content', message, 'field-unsupported');

/**
 * The instruction a call writes, or the refusal. A typed call writes the type's word followed
 * by `text`; `Empty` writes `text` as the whole instruction. TOC keeps its own switch subset.
 */
function instructionOf(operation: InsertFieldOperation): string | PlannedOperation {
  const type = operation.fieldType ?? 'Empty';
  const text = operation.text ?? '';
  if (type === 'TOC')
    return tocFieldCode(text) ?? fieldUnsupported('the TOC switches are not supported');
  const word = type === 'Empty' ? '' : FIELD_TYPE_WORDS[type];
  if (word === undefined) return fieldUnsupported(`the ${type} field type is not supported`);
  const instruction = inertFieldInstruction(word ? `${word} ${text}` : text);
  return (
    instruction ??
    fieldUnsupported('the field instruction is not one this API writes, or its arguments refuse')
  );
}

/** Whether `offset` or the replaced range touches a locked or bound inline control. */
function touchesProtectedContent(
  story: AutomationStoryReads,
  paragraphId: string,
  start: number,
  end: number
): boolean {
  if (effectiveContentLockAt(story.part, paragraphId).content) return true;
  if (isBoundAt(story.part, paragraphId)) return true;
  const paragraph = findNode(story.part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return false;
  return segmentsOf(paragraph).some(
    (segment) =>
      (start === end
        ? segment.start < start && segment.end > start
        : segment.start < end && segment.end > start) &&
      (effectiveContentLockAt(story.part, segment.node.id).content ||
        isBoundAt(story.part, segment.node.id))
  );
}

export function planFieldInsert(
  operation: InsertFieldOperation,
  range: ResolvedRange,
  story: AutomationStoryReads,
  handles: AutomationHandleTable,
  claim: (story: AutomationStoryReads, paragraphId: string) => PlannedOperation | null,
  trackingAuthor?: string
): PlannedOperation {
  if (operation.removeFormatting !== undefined && operation.removeFormatting !== false)
    return refuse('unsupported-content', 'removeFormatting is not supported', 'unsupported');
  if (operation.text !== undefined && typeof operation.text !== 'string')
    return refuse('unsupported-content', 'field text must be a string', 'invalidArgs');
  if (operation.fieldType !== undefined && typeof operation.fieldType !== 'string')
    return refuse('unsupported-content', 'field type must be a string', 'invalidArgs');
  const tracked = trackingAuthor !== undefined;
  // TOC fields hold their entries as a result this lane cannot propose: refuse as before.
  if (tracked && operation.fieldType === 'TOC')
    return refuse(
      'unsupported-capability',
      'insertField does not support TrackMineOnly for TOC fields; no permanent edit was applied',
      'change-tracking-operation-unsupported'
    );
  const instruction = instructionOf(operation);
  if (typeof instruction !== 'string') return instruction;
  const { start, end } = range;
  if (!['Before', 'After', 'Start', 'End', 'Replace'].includes(operation.location))
    return refuse('unsupported-content', 'unsupported field insert location', 'invalidArgs');
  const replace = operation.location === 'Replace';
  if (replace && start.paragraphId !== end.paragraphId)
    return refuse(
      'unsupported-content',
      'field replacement requires one paragraph',
      'invalid-range'
    );
  const point = operation.location === 'After' || operation.location === 'End' ? end : start;
  const paragraphId = point.paragraphId;
  const struck = replace && end.offset > start.offset;
  const from = struck ? start.offset : point.offset;
  const to = struck ? end.offset : point.offset;
  if (touchesProtectedContent(story, paragraphId, from, to))
    return refuse('unsupported-content', 'field insertion touches protected content', 'locked');
  const before = new Set(fieldsInParagraph(story.part, paragraphId).map((f) => f.fieldNodeId));
  const ops: TreeDocOp[] = [];
  if (!tracked) {
    const conflict = claim(story, paragraphId);
    if (conflict) return conflict;
    if (struck) ops.push({ op: 'deleteText', paragraphId, start: from, end: to });
    ops.push({
      op: 'insertFragment',
      paragraphId,
      offset: point.offset,
      blocks: [fieldInsertionParagraph(instruction)],
      lastMarkCovered: false,
    });
  } else {
    const author = trackingAuthor.trim();
    if (struck && from === 0) {
      const adjacent = ownMarkDeletionRefusal(story.part, paragraphId, author);
      if (adjacent) return adjacent;
    }
    // The same pending-revision rules a tracked text insertion or replacement follows.
    const revisionError = proposalRevisionError(
      story,
      paragraphId,
      from,
      to,
      struck ? undefined : author,
      !struck && to === (story.rawText(paragraphId) ?? '').length,
      struck ? author : undefined,
      { author }
    );
    if (revisionError) return { ok: false, error: revisionError };
    if (landsInForeignInsertionContainer(story, paragraphId, to, author))
      return refuse(
        'unsupported-revision',
        "the field would land inside a container within another author's pending insertion",
        'edit.tracked-foreign-revision-unsupported'
      );
    const conflict = claim(story, paragraphId);
    if (conflict) return conflict;
    const revision = { author, date: revisionDateNow() };
    if (struck) ops.push({ op: 'deleteText', paragraphId, start: from, end: to, revision });
    ops.push({ op: 'insertComplexField', paragraphId, offset: to, instruction, revision });
  }
  return {
    ok: true,
    kind: 'command',
    story: story.story,
    ops,
    answer: (post) => {
      const part = post.story(story.story)?.part;
      const inserted = part
        ? fieldsInParagraph(part, paragraphId).filter((field) => !before.has(field.fieldNodeId))
        : [];
      if (inserted.length !== 1) throw new Error('inserted field was not committed');
      return {
        kind: 'handle',
        handle: handles.field(paragraphId, inserted[0]!.fieldNodeId, story.story),
      };
    },
  };
}

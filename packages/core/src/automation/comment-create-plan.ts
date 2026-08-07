import { findNode, parentNodeOf } from '../store/package/ooxml-edit.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import type { AutomationCommentWrite } from './document-port.ts';
import type { AutomationHandleTable } from './handles.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan.ts';
import type { AutomationErrorCode, AutomationValue } from './protocol.ts';
import type { AutomationPackageReads, AutomationStoryReads } from './reads.ts';
import { resolveSpanRef, storyOfSpanRef } from './spans.ts';

const PARAGRAPH_BREAKING = /[\r\n\u2028\u2029]/u;
const APPLIED: AutomationValue = Object.freeze({ kind: 'applied' as const });

function refuse(code: AutomationErrorCode, message: string, detail?: string): PlannedOperation {
  return {
    ok: false,
    error: Object.freeze(detail === undefined ? { code, message } : { code, message, detail }),
  };
}

/** Innermost table cell containing a paragraph, or null for ordinary story flow. */
function tableCellOf(reads: AutomationStoryReads, paragraphId: string): string | null {
  let node = findNode(reads.part, paragraphId);
  while (node) {
    if (
      node.kind === 'tableCell' ||
      (node.kind !== 'textValue' &&
        node.namespaceUri === WML_NAMESPACE_URI &&
        node.localName === 'tc')
    ) {
      return node.id;
    }
    node = parentNodeOf(reads.part, node.id);
  }
  return null;
}

/** Plan root-comment creation without widening the central operation dispatcher. */
export function planInsertComment(
  operation: Extract<AutomationOperation, { readonly op: 'insertComment' }>,
  handles: AutomationHandleTable,
  packageReads: AutomationPackageReads,
  pinStory: (reads: AutomationStoryReads) => PlannedOperation | null
): PlannedOperation {
  if (typeof operation.author !== 'string' || operation.author.trim().length === 0) {
    return refuse('unsupported-content', 'a comment records who wrote it', 'author');
  }
  if (typeof operation.text !== 'string' || operation.text.length === 0) {
    return refuse('unsupported-content', 'a comment says something', 'text');
  }
  if (PARAGRAPH_BREAKING.test(operation.text)) {
    return refuse('unsupported-content', 'a comment is one paragraph in this slice', 'text');
  }
  const resolved = resolveSpanRef(operation.span, handles, packageReads);
  if (!resolved.ok) return refuse(resolved.code, 'that span is not a place', resolved.detail);
  if (resolved.value === null)
    return refuse('invalid-handle', 'an empty story has no comment anchor');
  const story = storyOfSpanRef(operation.span, handles, packageReads);
  if (!story.ok) return refuse(story.code, 'that span is not a place', story.detail);
  const range = resolved.value;
  if (
    tableCellOf(story.value, range.start.paragraphId) !==
    tableCellOf(story.value, range.end.paragraphId)
  ) {
    return refuse('unsupported-content', 'a comment range cannot cross a table-cell boundary');
  }
  const conflict = pinStory(story.value);
  if (conflict) return conflict;
  const write: AutomationCommentWrite = {
    kind: 'create',
    anchor: {
      paragraphId: range.start.paragraphId,
      start: range.start.offset,
      end: range.end.offset,
      ...(range.end.paragraphId === range.start.paragraphId
        ? {}
        : { endParagraphId: range.end.paragraphId }),
    },
    text: operation.text,
    author: operation.author,
    ...(typeof operation.date === 'string' ? { date: operation.date } : {}),
  };
  return {
    ok: true,
    kind: 'commentWrite',
    write,
    story: story.value.story,
    answer: (_post, commentId) =>
      commentId === undefined
        ? APPLIED
        : { kind: 'handle', handle: handles.comment(commentId, story.value.story) },
  };
}

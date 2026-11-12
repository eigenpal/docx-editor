// Which `replaceAllMatches` ranges the store would refuse, asked BEFORE any commit.
//
// A refused commit is found only by running it, and each run applies the ops and lays the
// story out. Asking the store's own rules per range first keeps a normal run to one commit
// per story, however many locked or struck matches the document holds.

import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlParagraphNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import { rangeTouchesContentRestriction } from '../store/store/tree-op-validate-controls.ts';
import type { TreeOpRejection } from '../store/store/tree-op-rejection.ts';

/** Why a range is skipped: struck text, or the store rule (a lock, a binding) that refuses it. */
export type MatchRangeSkip = 'deleted' | TreeOpRejection;

const REMOVED_CONTAINERS = new Set(['del', 'moveFrom']);

/** The `[start, end)` spans of struck text in a paragraph: `w:del` and `w:moveFrom` content. */
function removedSpans(paragraph: OoxmlParagraphNode): readonly { start: number; end: number }[] {
  const index = paragraphOffsetIndex(paragraph);
  const spans: { start: number; end: number }[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'deletedText') {
      const span = index.spanOf(node);
      if (span) spans.push(span);
      return;
    }
    if (node.namespaceUri === WML_NAMESPACE_URI && REMOVED_CONTAINERS.has(node.localName)) {
      const span = index.spanOf(node);
      if (span) spans.push(span);
      return;
    }
    for (const child of node.children) visit(child);
  };
  for (const child of paragraph.children) visit(child);
  return spans;
}

/**
 * Why one match cannot be replaced in place, or null. `landing` is where its insertion goes.
 * Struck text is skipped in every mode: replacing it again would stack a second proposal on a
 * removed word, and editing mode would turn a pending deletion into plain text.
 */
export function matchRangeSkip(
  part: OoxmlPart,
  paragraphId: string,
  start: number,
  end: number,
  landing: number
): MatchRangeSkip | null {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return 'locked';
  if (removedSpans(paragraph).some((span) => span.start < end && span.end > start))
    return 'deleted';
  return (
    rangeTouchesContentRestriction(part, paragraph, start, end) ??
    rangeTouchesContentRestriction(part, paragraph, landing, landing)
  );
}

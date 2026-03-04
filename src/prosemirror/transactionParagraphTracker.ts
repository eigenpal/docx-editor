import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';

function clampPosition(position: number, size: number): number {
  if (position < 0) return 0;
  if (position > size) return size;
  return position;
}

function normalizeRange(doc: PMNode, from: number, to: number): [number, number] | null {
  const size = doc.content.size;
  let start = clampPosition(Math.min(from, to), size);
  let end = clampPosition(Math.max(from, to), size);

  if (start === end) {
    start = clampPosition(start - 1, size);
    end = clampPosition(end + 1, size);
  }

  if (start >= end) {
    return null;
  }

  return [start, end];
}

function collectParagraphIdsInRange(
  doc: PMNode,
  from: number,
  to: number,
  paragraphIds: Set<string>
): void {
  const normalized = normalizeRange(doc, from, to);
  if (!normalized) return;

  const [start, end] = normalized;
  doc.nodesBetween(start, end, (node) => {
    if (node.type.name !== 'paragraph') {
      return true;
    }

    const paraId = node.attrs?.paraId;
    if (typeof paraId === 'string' && paraId.length > 0) {
      paragraphIds.add(paraId);
    }
    return true;
  });
}

/**
 * Extract paragraph IDs touched by a ProseMirror transaction.
 *
 * Uses transaction step maps to collect changed ranges from both old and new
 * documents. This lets save pipelines patch only paragraphs actually edited by
 * the user, instead of relying on full-document model diffs.
 */
export function getEditedParagraphIdsFromTransaction(
  transaction: Transaction,
  newState: EditorState
): string[] {
  if (!transaction.docChanged) {
    return [];
  }

  const paragraphIds = new Set<string>();
  const oldDoc = transaction.before;

  for (const map of transaction.mapping.maps) {
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      collectParagraphIdsInRange(oldDoc, oldStart, oldEnd, paragraphIds);
      collectParagraphIdsInRange(newState.doc, newStart, newEnd, paragraphIds);
    });
  }

  // Fallback for edge cases where map ranges don't expose the paragraph.
  if (paragraphIds.size === 0) {
    collectParagraphIdsInRange(
      oldDoc,
      transaction.selection.from,
      transaction.selection.to,
      paragraphIds
    );
    collectParagraphIdsInRange(
      newState.doc,
      newState.selection.from,
      newState.selection.to,
      paragraphIds
    );
  }

  return [...paragraphIds];
}

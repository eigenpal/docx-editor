/**
 * Pure ProseMirror lookup helpers used by DocxEditorVue's agent-facing
 * commands — paragraph-by-paraId, vanilla-view text extraction (skips
 * text inside `insertion` marks so the agent reads the same view that
 * `addComment` / `proposeChange` anchor against).
 *
 * Mirrors the React side at
 * `packages/react/src/components/DocxEditor/helpers.ts`. Kept duplicated
 * for now — consolidating into `@eigenpal/docx-editor-core/utils` is a
 * separate cross-package change.
 *
 * TODO(file-size-cap): move these four into
 * `@eigenpal/docx-editor-core/utils/paraText` so both adapters import
 * from one source. Grep for `paraText` to find the React/Vue twins.
 */

import type { Node as ProseMirrorNode } from 'prosemirror-model';

/**
 * Find the ProseMirror position range for a paragraph by Word `w14:paraId`.
 * Returns `from` (position before the textblock) and `to` (`from + nodeSize`).
 */
export function findParaIdRange(
  doc: ProseMirrorNode,
  paraId: string
): { from: number; to: number } | null {
  if (!paraId.trim()) return null;
  let result: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (result) return false;
    if (node.isTextblock && node.attrs?.paraId === paraId) {
      result = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  return result;
}

/**
 * Vanilla-view text of a PM node — concatenates descendant text content,
 * skipping any text inside an `insertion` mark so what the agent reads
 * matches what comment/suggest tools can anchor.
 */
export function getVanillaNodeText(node: ProseMirrorNode): string {
  const parts: string[] = [];
  node.descendants((child) => {
    if (!child.isText || !child.text) return true;
    if (child.marks.some((mark) => mark.type.name === 'insertion')) return false;
    parts.push(child.text);
    return true;
  });
  return parts.join('');
}

/**
 * Vanilla-view text between two doc positions. Same semantics as
 * `getVanillaNodeText`, range-scoped instead of node-scoped.
 */
export function getVanillaTextBetween(doc: ProseMirrorNode, from: number, to: number): string {
  if (from >= to) return '';
  const parts: string[] = [];
  doc.nodesBetween(from, to, (child, pos) => {
    if (!child.isText || !child.text) return;
    if (child.marks.some((mark) => mark.type.name === 'insertion')) return;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + child.text.length);
    if (start < end) parts.push(child.text.slice(start - pos, end - pos));
  });
  return parts.join('');
}

/**
 * Find a text string within a ProseMirror paragraph node range and return
 * its positions. Returns null when not found, when ambiguous (multiple
 * matches in the same paragraph), or when searchText is empty.
 */
export function findTextInPmParagraph(
  doc: ProseMirrorNode,
  paragraphFrom: number,
  paragraphTo: number,
  searchText: string
): { from: number; to: number } | null {
  if (!searchText) return null;
  let fullText = '';
  const textPositions: { pos: number; len: number }[] = [];

  doc.nodesBetween(paragraphFrom, paragraphTo, (node, pos) => {
    if (!node.isText || !node.text) return;
    if (node.marks.some((mark) => mark.type.name === 'insertion')) return;
    textPositions.push({ pos, len: node.text.length });
    fullText += node.text;
  });

  const firstMatch = fullText.indexOf(searchText);
  if (firstMatch === -1) return null;
  if (fullText.indexOf(searchText, firstMatch + 1) !== -1) return null;

  let charOffset = 0;
  let fromPos = paragraphFrom;
  let toPos = paragraphFrom;
  for (const textPos of textPositions) {
    const segmentEnd = charOffset + textPos.len;
    if (charOffset <= firstMatch && firstMatch < segmentEnd) {
      fromPos = textPos.pos + (firstMatch - charOffset);
    }
    if (
      charOffset <= firstMatch + searchText.length &&
      firstMatch + searchText.length <= segmentEnd
    ) {
      toPos = textPos.pos + (firstMatch + searchText.length - charOffset);
      break;
    }
    charOffset = segmentEnd;
  }

  return { from: fromPos, to: toPos };
}

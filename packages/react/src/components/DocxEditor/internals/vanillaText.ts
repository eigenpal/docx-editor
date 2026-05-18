/**
 * "Vanilla view" text extraction for DocxEditor.
 *
 * Skips text inside `insertion` marks (tracked-change additions that
 * aren't accepted yet) so the agent's view of the document matches what
 * `add_comment` / `suggest_change` can anchor to. Tracked deletions stay
 * included — they're still in the doc until accepted.
 */

import type { Node as PMNode } from 'prosemirror-model';

/** Text of a single PM node (typically a paragraph), vanilla view. */
export function getVanillaNodeText(node: PMNode): string {
  const parts: string[] = [];
  node.descendants((child) => {
    if (!child.isText || !child.text) return true;
    if (child.marks.some((m) => m.type.name === 'insertion')) return false;
    parts.push(child.text);
    return true;
  });
  return parts.join('');
}

/** Text between two doc positions, vanilla view. */
export function getVanillaTextBetween(doc: PMNode, from: number, to: number): string {
  if (from >= to) return '';
  const parts: string[] = [];
  doc.nodesBetween(from, to, (child, pos) => {
    if (!child.isText || !child.text) return;
    if (child.marks.some((m) => m.type.name === 'insertion')) return;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + child.text.length);
    if (start < end) parts.push(child.text.slice(start - pos, end - pos));
  });
  return parts.join('');
}

/**
 * Find `searchText` within a PM paragraph range and return its position.
 *
 * Returns null if:
 *   - searchText is empty
 *   - searchText is not found
 *   - searchText appears more than once (ambiguous; caller disambiguates)
 *
 * The fullText is built from PM text nodes only and matches the vanilla
 * view the agent reads via `read_document`: tracked insertions are
 * excluded (not in the doc yet), tracked deletions are included (still
 * in the doc until accepted), and comment markers are stripped.
 */
export function findTextInPmParagraph(
  doc: PMNode,
  paragraphFrom: number,
  paragraphTo: number,
  searchText: string
): { from: number; to: number } | null {
  if (!searchText) return null;

  let fullText = '';
  const textPositions: { pos: number; len: number }[] = [];

  doc.nodesBetween(paragraphFrom, paragraphTo, (node, pos) => {
    if (!node.isText || !node.text) return;
    if (node.marks.some((m) => m.type.name === 'insertion')) return;
    textPositions.push({ pos, len: node.text.length });
    fullText += node.text;
  });

  const firstMatch = fullText.indexOf(searchText);
  if (firstMatch === -1) return null;
  // Reject ambiguous searches — the LLM gets a clearer error than a silent mistarget.
  const secondMatch = fullText.indexOf(searchText, firstMatch + 1);
  if (secondMatch !== -1) return null;

  // Map string offset back to PM position.
  let charOffset = 0;
  let fromPos = paragraphFrom;
  let toPos = paragraphFrom;

  for (const tp of textPositions) {
    const segEnd = charOffset + tp.len;
    if (charOffset <= firstMatch && firstMatch < segEnd) {
      fromPos = tp.pos + (firstMatch - charOffset);
    }
    if (charOffset <= firstMatch + searchText.length && firstMatch + searchText.length <= segEnd) {
      toPos = tp.pos + (firstMatch + searchText.length - charOffset);
      break;
    }
    charOffset = segEnd;
  }

  return { from: fromPos, to: toPos };
}

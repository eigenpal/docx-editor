/**
 * Shared utilities for the agents package.
 */

import type {
  DocumentBody,
  Paragraph,
  BlockContent,
  Footnote,
  Endnote,
  Run,
  Hyperlink,
  ParagraphContent,
  Insertion,
  Deletion,
  MoveFrom,
  MoveTo,
} from '@eigenpal/docx-editor-core/headless';
import {
  getRunText,
  getHyperlinkText,
  isHeadingStyle,
  parseHeadingLevel,
} from '@eigenpal/docx-editor-core/headless';

// Re-export from core so other modules import from one place
export { getRunText, getHyperlinkText, isHeadingStyle, parseHeadingLevel };

// ============================================================================
// TRACKED CHANGE HELPERS
// ============================================================================

export type TrackedChangeItem = Insertion | Deletion | MoveFrom | MoveTo;

export function isTrackedChange(item: ParagraphContent): item is TrackedChangeItem {
  return (
    item.type === 'insertion' ||
    item.type === 'deletion' ||
    item.type === 'moveFrom' ||
    item.type === 'moveTo'
  );
}

export function getTrackedChangeText(content: (Run | Hyperlink)[]): string {
  const parts: string[] = [];
  for (const item of content) {
    if (item.type === 'run') {
      parts.push(getRunText(item));
    } else if (item.type === 'hyperlink') {
      parts.push(getHyperlinkText(item));
    }
  }
  return parts.join('');
}

// ============================================================================
// DOCUMENT TRAVERSAL
// ============================================================================

/**
 * Get a paragraph by its document-wide index (counting into tables).
 * Throws on out-of-bounds.
 */
export function getParagraphAtIndex(body: DocumentBody, paragraphIndex: number): Paragraph {
  let index = 0;
  for (const block of body.content) {
    if (block.type === 'paragraph') {
      if (index === paragraphIndex) return block;
      index++;
    } else if (block.type === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const cellBlock of cell.content) {
            if (cellBlock.type === 'paragraph') {
              if (index === paragraphIndex) return cellBlock;
              index++;
            }
          }
        }
      }
    } else {
      index++;
    }
  }
  throw new Error(`Paragraph index ${paragraphIndex} out of bounds (max: ${index - 1})`);
}

/**
 * Walk paragraphs in a block sequence (including paragraphs inside tables),
 * calling `fn` with each paragraph and a running index; returning `false` from
 * `fn` stops the walk early.
 *
 * `countOther` controls how non-paragraph, non-table blocks affect the index:
 * the document body advances the index over them (so it stays a document-wide
 * paragraph index — `getParagraphAtIndex`'s contract), whereas note bodies hold
 * only paragraphs and tables and want a dense note-local index.
 */
function walkParagraphs(
  blocks: readonly BlockContent[],
  countOther: boolean,
  fn: (para: Paragraph, index: number) => void | boolean
): void {
  let index = 0;
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      if (fn(block, index) === false) return;
      index++;
    } else if (block.type === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const cellBlock of cell.content) {
            if (cellBlock.type === 'paragraph') {
              if (fn(cellBlock, index) === false) return;
              index++;
            }
          }
        }
      }
    } else if (countOther) {
      index++;
    }
  }
}

/**
 * Walk all paragraphs in the document body (including inside tables),
 * calling the callback with each paragraph and its document-wide index.
 */
export function forEachParagraph(
  body: DocumentBody,
  fn: (para: Paragraph, index: number) => void | boolean
): void {
  walkParagraphs(body.content, true, fn);
}

/**
 * Walk every paragraph in a footnote/endnote body (including paragraphs inside
 * tables), calling the callback with each paragraph and its note-local index.
 * Mirrors {@link forEachParagraph} but over a single note's `(Paragraph |
 * Table)[]` content rather than the document body.
 */
export function forEachNoteParagraph(
  note: Footnote | Endnote,
  fn: (para: Paragraph, index: number) => void | boolean
): void {
  walkParagraphs(note.content, false, fn);
}

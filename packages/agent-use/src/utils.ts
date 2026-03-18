/**
 * Shared utilities for agent-use package.
 */

import type {
  DocumentBody,
  Paragraph,
  Run,
  Hyperlink,
  ParagraphContent,
  Insertion,
  Deletion,
  MoveFrom,
  MoveTo,
} from '@eigenpal/docx-core/headless';
import {
  getRunText,
  getHyperlinkText,
  isHeadingStyle,
  parseHeadingLevel,
} from '@eigenpal/docx-core/headless';

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
 * Walk all paragraphs in the document body (including inside tables),
 * calling the callback with each paragraph and its document-wide index.
 */
export function forEachParagraph(
  body: DocumentBody,
  fn: (para: Paragraph, index: number) => void | boolean
): void {
  let index = 0;
  for (const block of body.content) {
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
    } else {
      index++;
    }
  }
}

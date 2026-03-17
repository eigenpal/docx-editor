/**
 * getContent() — renders document as structured ContentBlock array for LLM consumption.
 */

import type { DocumentBody, Paragraph, Table } from '@eigenpal/docx-core/headless';
import type { ContentBlock, GetContentOptions } from './types';
import {
  getRunText,
  getHyperlinkText,
  getTrackedChangeText,
  isTrackedChange,
  isHeadingStyle,
  parseHeadingLevel,
} from './utils';

/**
 * Walk document body and produce ContentBlock array.
 */
export function getContent(body: DocumentBody, options: GetContentOptions = {}): ContentBlock[] {
  const {
    fromIndex,
    toIndex,
    includeTrackedChanges = true,
    includeCommentAnchors = true,
  } = options;

  const blocks: ContentBlock[] = [];
  let index = 0;

  for (const block of body.content) {
    if (block.type === 'paragraph') {
      if (isInRange(index, fromIndex, toIndex)) {
        blocks.push(
          buildParagraphBlock(block, index, includeTrackedChanges, includeCommentAnchors)
        );
      }
      index++;
    } else if (block.type === 'table') {
      if (isInRange(index, fromIndex, toIndex)) {
        blocks.push(buildTableBlock(block, index, includeTrackedChanges, includeCommentAnchors));
      }
      index++;
    } else {
      index++;
    }
  }

  return blocks;
}

function isInRange(index: number, from?: number, to?: number): boolean {
  return (from === undefined || index >= from) && (to === undefined || index <= to);
}

function buildParagraphBlock(
  para: Paragraph,
  index: number,
  includeTrackedChanges: boolean,
  includeCommentAnchors: boolean
): ContentBlock {
  const text = buildParagraphText(para, includeTrackedChanges, includeCommentAnchors);
  const styleId = para.formatting?.styleId;

  if (isHeadingStyle(styleId)) {
    return {
      type: 'heading',
      index,
      level: parseHeadingLevel(styleId) ?? 1,
      text,
    };
  }

  if (para.listRendering) {
    return {
      type: 'list-item',
      index,
      text,
      listLevel: para.listRendering.level ?? 0,
      listType: para.listRendering.isBullet ? 'bullet' : 'number',
    };
  }

  return { type: 'paragraph', index, text };
}

function buildTableBlock(
  table: Table,
  index: number,
  includeTrackedChanges: boolean,
  includeCommentAnchors: boolean
): ContentBlock {
  const rows: string[][] = [];
  for (const row of table.rows) {
    const cells: string[] = [];
    for (const cell of row.cells) {
      const cellTexts: string[] = [];
      for (const block of cell.content) {
        if (block.type === 'paragraph') {
          cellTexts.push(buildParagraphText(block, includeTrackedChanges, includeCommentAnchors));
        }
      }
      cells.push(cellTexts.join('\n'));
    }
    rows.push(cells);
  }
  return { type: 'table', index, rows };
}

/**
 * Build paragraph text with optional inline annotations for tracked changes and comments.
 */
function buildParagraphText(
  para: Paragraph,
  includeTrackedChanges: boolean,
  includeCommentAnchors: boolean
): string {
  const parts: string[] = [];
  const activeCommentIds = new Set<number>();

  for (const item of para.content) {
    if (item.type === 'commentRangeStart' && includeCommentAnchors) {
      activeCommentIds.add(item.id);
      parts.push(`[comment:${item.id}]`);
      continue;
    }
    if (item.type === 'commentRangeEnd' && includeCommentAnchors) {
      if (activeCommentIds.has(item.id)) {
        activeCommentIds.delete(item.id);
        parts.push('[/comment]');
      }
      continue;
    }

    if (item.type === 'run') {
      parts.push(getRunText(item));
    } else if (item.type === 'hyperlink') {
      parts.push(getHyperlinkText(item));
    } else if (isTrackedChange(item)) {
      const text = getTrackedChangeText(item.content);
      if (item.type === 'insertion' || item.type === 'moveTo') {
        if (includeTrackedChanges) {
          parts.push(`[+${text}+]{by:${item.info.author}}`);
        } else {
          parts.push(text);
        }
      } else {
        // deletion or moveFrom
        if (includeTrackedChanges) {
          parts.push(`[-${text}-]{by:${item.info.author}}`);
        }
        // When not annotating, hide deleted/moveFrom text
      }
    }
  }

  return parts.join('');
}

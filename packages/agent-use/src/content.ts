/**
 * getContent() — renders document as structured ContentBlock array for LLM consumption.
 * formatContentForLLM() — converts blocks to plain text (avoids JSON quote-escaping issues).
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
      // Advance by number of cell paragraphs (matching getParagraphAtIndex counting)
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const cellBlock of cell.content) {
            if (cellBlock.type === 'paragraph') {
              index++;
            }
          }
        }
      }
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
  const paraId = para.paraId;

  if (isHeadingStyle(styleId)) {
    return {
      type: 'heading',
      index,
      paraId,
      level: parseHeadingLevel(styleId) ?? 1,
      text,
    };
  }

  if (para.listRendering) {
    return {
      type: 'list-item',
      index,
      paraId,
      text,
      listLevel: para.listRendering.level ?? 0,
      listType: para.listRendering.isBullet ? 'bullet' : 'number',
    };
  }

  return { type: 'paragraph', index, paraId, text };
}

function buildTableBlock(
  table: Table,
  index: number,
  includeTrackedChanges: boolean,
  includeCommentAnchors: boolean
): ContentBlock {
  const rows: string[][] = [];
  const cellParaIds: (string | undefined)[][] = [];
  for (const row of table.rows) {
    const cells: string[] = [];
    const rowParaIds: (string | undefined)[] = [];
    for (const cell of row.cells) {
      const cellTexts: string[] = [];
      let firstParaId: string | undefined;
      for (const block of cell.content) {
        if (block.type === 'paragraph') {
          if (firstParaId === undefined) firstParaId = block.paraId;
          cellTexts.push(buildParagraphText(block, includeTrackedChanges, includeCommentAnchors));
        }
      }
      cells.push(cellTexts.join('\n'));
      rowParaIds.push(firstParaId);
    }
    rows.push(cells);
    cellParaIds.push(rowParaIds);
  }
  return { type: 'table', index, rows, cellParaIds };
}

/**
 * Format content blocks as plain text for LLM prompts.
 *
 * When a block has a `paraId`, it's used as the line anchor (preferred — stable
 * across edits). Falls back to the ordinal index when paraId is absent.
 *
 * Output:
 *   [0] (h1) Chapter Title
 *   [1] Paragraph text here.
 *   [2] • Bullet item
 *   [3] (table, row 1, col 1) First cell
 *   [4] (table, row 1, col 2) Second cell
 */
export function formatContentForLLM(blocks: ContentBlock[]): string {
  const lines: string[] = [];
  const tag = (b: { paraId?: string; index: number }) => (b.paraId ? b.paraId : String(b.index));
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        lines.push(`[${tag(block)}] (h${block.level}) ${block.text}`);
        break;
      case 'paragraph':
        lines.push(`[${tag(block)}] ${block.text}`);
        break;
      case 'list-item': {
        const indent = '  '.repeat(block.listLevel);
        const bullet = block.listType === 'bullet' ? '\u2022' : '-';
        lines.push(`[${tag(block)}] ${indent}${bullet} ${block.text}`);
        break;
      }
      case 'table': {
        let idx = block.index;
        for (let r = 0; r < block.rows.length; r++) {
          for (let c = 0; c < block.rows[r].length; c++) {
            const cellText = block.rows[r][c];
            const paras = cellText.split('\n');
            const cellParaId = block.cellParaIds?.[r]?.[c];
            for (let p = 0; p < paras.length; p++) {
              const anchor = p === 0 && cellParaId ? cellParaId : String(idx);
              lines.push(`[${anchor}] (table, row ${r + 1}, col ${c + 1}) ${paras[p]}`);
              idx++;
            }
          }
        }
        break;
      }
    }
  }
  return lines.join('\n');
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
      // Vanilla view (includeTrackedChanges=false): insertions aren't in the
      // doc yet so they're hidden; deletions still are, so they appear as
      // plain text. Annotated view wraps both with [+...+] / [-...-] markers.
      if (item.type === 'insertion' || item.type === 'moveTo') {
        if (includeTrackedChanges) parts.push(`[+${text}+]{by:${item.info.author}}`);
      } else {
        if (includeTrackedChanges) parts.push(`[-${text}-]{by:${item.info.author}}`);
        else parts.push(text);
      }
    }
  }

  return parts.join('');
}

import {
  flattenContentControls,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { collectFlowBlocks } from '../store/package/content-control-walk.ts';

const rowParagraphs = new WeakMap<
  OoxmlNode,
  { remaining: number; paragraphs: readonly OoxmlElement[] }
>();

/** Collect story paragraphs, preserving table depth limits across immutable row reuse. */
export function walkStoryParagraphs(
  blocks: readonly OoxmlElement[],
  maxTableDepth = 8
): OoxmlElement[] {
  const out: OoxmlElement[] = [];
  pushStoryParagraphs(blocks, maxTableDepth, out);
  return out;
}

/**
 * The paragraphs `walkStoryParagraphs` collects for one table row, where `remaining` is the
 * table depth still allowed at the row's table (its walk's `maxTableDepth` minus the depth).
 */
export function storyRowParagraphs(row: OoxmlElement, remaining: number): readonly OoxmlElement[] {
  const cached = rowParagraphs.get(row);
  if (cached?.remaining === remaining) return cached.paragraphs;
  const out: OoxmlElement[] = [];
  pushRowParagraphs(row, remaining, out);
  return out;
}

function pushStoryParagraphs(
  blocks: readonly OoxmlElement[],
  maxTableDepth: number,
  out: OoxmlElement[]
): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      out.push(block);
      continue;
    }
    if (block.kind !== 'table' || maxTableDepth <= 0) continue;
    for (const row of flattenContentControls(block.children)) {
      if (row.kind === 'tableRow') pushRowParagraphs(row, maxTableDepth, out);
    }
  }
}

function pushRowParagraphs(row: OoxmlElement, remaining: number, out: OoxmlElement[]): void {
  const cached = rowParagraphs.get(row);
  if (cached?.remaining === remaining) {
    for (const paragraph of cached.paragraphs) out.push(paragraph);
    return;
  }
  const start = out.length;
  for (const cell of flattenContentControls(row.children)) {
    if (cell.kind !== 'tableCell') continue;
    // Flatten cell SDTs under the shared content-control budget; table nesting still
    // uses the remaining depth for the table walk itself.
    pushStoryParagraphs(collectFlowBlocks(cell.children), remaining - 1, out);
  }
  if (out.length - start <= 256)
    rowParagraphs.set(row, { remaining, paragraphs: out.slice(start) });
}

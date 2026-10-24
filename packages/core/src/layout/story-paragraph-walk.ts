import {
  flattenContentControls,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { collectFlowBlocks } from '../store/package/content-control-walk.ts';
import { readVMerge } from './table-row-properties.ts';

type RowParagraphCache = WeakMap<
  OoxmlNode,
  { remaining: number; paragraphs: readonly OoxmlElement[] }
>;

/** One cache per `skipMergedCells` value, so numbering and other walks never evict each other. */
const rowParagraphs: readonly [RowParagraphCache, RowParagraphCache] = [
  new WeakMap(),
  new WeakMap(),
];
const rowCache = (skipMergedCells: boolean) => rowParagraphs[skipMergedCells ? 1 : 0];

/**
 * Collect story paragraphs, preserving table depth limits across immutable row reuse.
 *
 * `skipMergedCells` leaves out the paragraphs of cells a vertical merge continues
 * (`w:vMerge` without `restart`). List numbering skips them: a numbered paragraph in each
 * merged-away cell does not advance the count shown in the cells that head the merges.
 */
export function walkStoryParagraphs(
  blocks: readonly OoxmlElement[],
  maxTableDepth = 8,
  skipMergedCells = false
): OoxmlElement[] {
  const out: OoxmlElement[] = [];
  pushStoryParagraphs(blocks, maxTableDepth, out, skipMergedCells);
  return out;
}

/**
 * The paragraphs `walkStoryParagraphs` collects for one table row, where `remaining` is the
 * table depth still allowed at the row's table (its walk's `maxTableDepth` minus the depth).
 */
export function storyRowParagraphs(row: OoxmlElement, remaining: number): readonly OoxmlElement[] {
  const cached = rowCache(false).get(row);
  if (cached?.remaining === remaining) return cached.paragraphs;
  const out: OoxmlElement[] = [];
  pushRowParagraphs(row, remaining, out, false);
  return out;
}

function pushStoryParagraphs(
  blocks: readonly OoxmlElement[],
  maxTableDepth: number,
  out: OoxmlElement[],
  skipMergedCells: boolean
): void {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      out.push(block);
      continue;
    }
    if (block.kind !== 'table' || maxTableDepth <= 0) continue;
    for (const row of flattenContentControls(block.children)) {
      if (row.kind === 'tableRow') pushRowParagraphs(row, maxTableDepth, out, skipMergedCells);
    }
  }
}

function pushRowParagraphs(
  row: OoxmlElement,
  remaining: number,
  out: OoxmlElement[],
  skipMergedCells: boolean
): void {
  const cache = rowCache(skipMergedCells);
  const cached = cache.get(row);
  if (cached?.remaining === remaining) {
    for (const paragraph of cached.paragraphs) out.push(paragraph);
    return;
  }
  const start = out.length;
  for (const cell of flattenContentControls(row.children)) {
    if (cell.kind !== 'tableCell') continue;
    if (skipMergedCells && continuesVerticalMerge(cell)) continue;
    // Flatten cell SDTs under the shared content-control budget; table nesting still
    // uses the remaining depth for the table walk itself.
    pushStoryParagraphs(collectFlowBlocks(cell.children), remaining - 1, out, skipMergedCells);
  }
  if (out.length - start <= 256) cache.set(row, { remaining, paragraphs: out.slice(start) });
}

function continuesVerticalMerge(cell: OoxmlElement): boolean {
  for (const child of cell.children) {
    if (child.kind !== 'textValue' && 'localName' in child && child.localName === 'tcPr')
      return readVMerge(child as OoxmlElement) === 'continue';
  }
  return false;
}

import {
  flattenContentControls,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { collectFlowBlocks } from '../store/package/content-control-walk.ts';
import { readGridSkip, readGridSpan, readVMerge } from './table-row-properties.ts';

const rowParagraphs = new WeakMap<
  OoxmlNode,
  { remaining: number; skipped: string; paragraphs: readonly OoxmlElement[] }
>();

const NO_COLUMNS: ReadonlySet<number> = new Set();

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
  if (cached?.remaining === remaining && cached.skipped === '') return cached.paragraphs;
  const out: OoxmlElement[] = [];
  pushRowParagraphs(row, remaining, NO_COLUMNS, out);
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
    // Grid columns where the previous row has a `w:vMerge` cell. A continuation cell below
    // one shows nothing, so its paragraphs neither paint nor take a list number.
    let mergedAbove = NO_COLUMNS;
    for (const row of flattenContentControls(block.children)) {
      if (row.kind === 'tableRow')
        mergedAbove = pushRowParagraphs(row, maxTableDepth, mergedAbove, out);
    }
  }
}

/** A row's cells with their grid columns, and the columns that hold a `w:vMerge` cell. */
interface RowMergePlan {
  readonly cells: readonly { cell: OoxmlElement; column: number; continues: boolean }[];
  readonly merged: ReadonlySet<number>;
}

const rowMergePlans = new WeakMap<OoxmlNode, RowMergePlan>();

function rowMergePlan(row: OoxmlElement): RowMergePlan {
  const known = rowMergePlans.get(row);
  if (known) return known;
  const children = flattenContentControls(row.children);
  const rowProperties = children.find((child) => child.localName === 'trPr');
  let column = readGridSkip(rowProperties, 'gridBefore');
  const cells: { cell: OoxmlElement; column: number; continues: boolean }[] = [];
  const merged = new Set<number>();
  for (const cell of children) {
    if (cell.kind !== 'tableCell') continue;
    const cellProperties = cell.children.find(
      (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'tcPr'
    );
    const vMerge = readVMerge(cellProperties);
    if (vMerge !== 'none') merged.add(column);
    cells.push({ cell, column, continues: vMerge === 'continue' });
    column += readGridSpan(cellProperties);
  }
  const plan = { cells, merged };
  rowMergePlans.set(row, plan);
  return plan;
}

/** Push one row's paragraphs; returns the grid columns where this row has a `w:vMerge` cell. */
function pushRowParagraphs(
  row: OoxmlElement,
  remaining: number,
  mergedAbove: ReadonlySet<number>,
  out: OoxmlElement[]
): ReadonlySet<number> {
  const plan = rowMergePlan(row);
  let key = '';
  for (const entry of plan.cells) {
    if (entry.continues && mergedAbove.has(entry.column)) key += `${entry.column},`;
  }
  const cached = rowParagraphs.get(row);
  if (cached?.remaining === remaining && cached.skipped === key) {
    for (const paragraph of cached.paragraphs) out.push(paragraph);
    return plan.merged;
  }
  const start = out.length;
  for (const entry of plan.cells) {
    if (entry.continues && mergedAbove.has(entry.column)) continue;
    // Flatten cell SDTs under the shared content-control budget; table nesting still
    // uses the remaining depth for the table walk itself.
    pushStoryParagraphs(collectFlowBlocks(entry.cell.children), remaining - 1, out);
  }
  if (out.length - start <= 256)
    rowParagraphs.set(row, { remaining, skipped: key, paragraphs: out.slice(start) });
  return plan.merged;
}

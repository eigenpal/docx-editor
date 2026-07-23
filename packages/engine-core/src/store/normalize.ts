// Deterministic normalization + repair (document-engine task 4.6). Rules are
// idempotent and order-free so equivalent converged inputs produce byte-equivalent
// normalized authored state: adjacent runs with identical props merge, empty runs
// drop, and a story is never left with zero blocks. Identity is preserved (no id
// is minted or dropped here).

import {
  type PackageModel,
  type ParagraphRecord,
  type Story,
  type Block,
  type TableRecord,
  type TableRowRecord,
  type TableCellRecord,
  type SdtRecord,
} from '../model/index.ts';
import { normalizeRuns } from '../model/normalize-runs.ts';

export { normalizeRuns };

function normalizeParagraph(p: ParagraphRecord): ParagraphRecord {
  const runs = normalizeRuns(p.runs);
  return runs.length === p.runs.length && runs.every((r, i) => r === p.runs[i]) ? p : { ...p, runs };
}

function normalizeCell(cell: TableCellRecord): TableCellRecord {
  const blocks = normalizeBlocks(cell.blocks);
  return blocks === cell.blocks ? cell : { ...cell, blocks };
}

function normalizeRow(row: TableRowRecord): TableRowRecord {
  let changed = false;
  const cells = row.cells.map((c) => {
    const nc = normalizeCell(c);
    if (nc !== c) changed = true;
    return nc;
  });
  return changed ? { ...row, cells } : row;
}

function normalizeTable(t: TableRecord): TableRecord {
  let changed = false;
  const rows = t.rows.map((r) => {
    const nr = normalizeRow(r);
    if (nr !== r) changed = true;
    return nr;
  });
  return changed ? { ...t, rows } : t;
}

function normalizeSdt(s: SdtRecord): SdtRecord {
  const blocks = normalizeBlocks(s.blocks);
  return blocks === s.blocks ? s : { ...s, blocks };
}

/** Normalize a block by kind. Recurses through tables (rows -> cells -> nested blocks)
 *  and content controls (SDT content) so nested content never reaches paragraph-only
 *  code paths. */
function normalizeBlock(block: Block): Block {
  if (block.kind === 'table') return normalizeTable(block);
  if (block.kind === 'sdt') return normalizeSdt(block);
  return normalizeParagraph(block);
}

/** Normalize a block list, returning the SAME array reference when nothing changed. */
function normalizeBlocks(blocks: readonly Block[]): readonly Block[] {
  let changed = false;
  const out = blocks.map((b) => {
    const nb = normalizeBlock(b);
    if (nb !== b) changed = true;
    return nb;
  });
  return changed ? out : blocks;
}

/** Normalize every story's blocks recursively; each story keeps its block count. */
export function normalize(model: PackageModel): PackageModel {
  let changed = false;
  const stories = new Map(model.stories);
  for (const [storyId, story] of model.stories) {
    const blocks = normalizeBlocks(story.blocks);
    if (blocks !== story.blocks) {
      const next: Story = { ...story, blocks };
      stories.set(storyId, next);
      changed = true;
    }
  }
  return changed ? { ...model, stories } : model;
}

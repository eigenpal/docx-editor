// Core block capability registry (comprehensive 3.1–3.3). Each block kind (paragraph, table,
// block SDT) registers its CORE engine operations HERE instead of central `switch (block.kind)`
// statements: content hashing (preservation edit-detection), normalization (canonicalize on
// commit), and serialization (regenerate WordprocessingML). The registry lives in the model layer
// so the store (normalize-on-commit), the preservation hasher, and the serializer all dispatch
// DOWNWARD through it — no upward imports, no duplicated dispatch. Registration is additive per
// kind (a low layer contributes hash+normalize; the package layer contributes serialize) and each
// operation is fetched independently, so a caller only requires the op it uses. New block kinds
// register a capability here instead of editing every switch (design decision 1).

import type { Block, ParagraphRecord, TableRecord, SdtRecord, TableCellRecord, TableRowRecord } from './authored-model.ts';
import { normalizeRuns } from './normalize-runs.ts';

export type BlockKind = Block['kind']; // 'paragraph' | 'table' | 'sdt'

/** Normalize a nested block list through the registry (passed to a container capability so it
 *  never re-implements paragraph/table/SDT handling). Returns the SAME reference when unchanged. */
export type RecurseNormalize = (blocks: readonly Block[]) => readonly Block[];
/** Hash a nested block (passed to a container capability's hashContent). */
export type RecurseHash = (block: Block) => unknown;

/** The core operations one block kind contributes. Each is optional at registration so different
 *  layers can add their part; a caller fetching a missing op gets a clear error. */
export interface CoreBlockCapability {
  readonly kind: BlockKind;
  /** Identity-stripped content view for the preservation content hash. */
  readonly hashContent?: (block: Block, recurse: RecurseHash) => unknown;
  /** Canonicalized block (idempotent). */
  readonly normalize?: (block: Block, recurse: RecurseNormalize) => Block;
  /** Regenerate the block's WordprocessingML (throws if it is not byte-faithfully regenerable). */
  readonly serialize?: (block: Block) => string;
}

const registry = new Map<BlockKind, CoreBlockCapability>();

/** Register (or augment) a block kind's core capability. Additive: later calls merge new ops. */
export function registerCoreBlockCapability(cap: CoreBlockCapability): void {
  const prev = registry.get(cap.kind);
  registry.set(cap.kind, { ...prev, ...cap, kind: cap.kind });
}

function opFor<K extends keyof CoreBlockCapability>(kind: BlockKind, op: K): NonNullable<CoreBlockCapability[K]> {
  const cap = registry.get(kind);
  const fn = cap?.[op];
  if (!fn) throw new Error(`no core block capability '${String(op)}' registered for block kind '${kind}'`);
  return fn as NonNullable<CoreBlockCapability[K]>;
}

export const blockHashContent = (block: Block, recurse: RecurseHash): unknown => opFor(block.kind, 'hashContent')(block, recurse);
export const blockNormalize = (block: Block, recurse: RecurseNormalize): Block => opFor(block.kind, 'normalize')(block, recurse);
export const blockSerialize = (block: Block): string => opFor(block.kind, 'serialize')(block);
export const hasBlockSerialize = (kind: BlockKind): boolean => !!registry.get(kind)?.serialize;

// --- built-in hash + normalize (pure, model-level). Serialize is contributed from package/. ---

function normalizeParagraph(p: ParagraphRecord): ParagraphRecord {
  const runs = normalizeRuns(p.runs);
  return runs.length === p.runs.length && runs.every((r, i) => r === p.runs[i]) ? p : { ...p, runs };
}
function normalizeCell(cell: TableCellRecord, recurse: RecurseNormalize): TableCellRecord {
  const blocks = recurse(cell.blocks);
  return blocks === cell.blocks ? cell : { ...cell, blocks };
}
function normalizeRow(row: TableRowRecord, recurse: RecurseNormalize): TableRowRecord {
  let changed = false;
  const cells = row.cells.map((c) => {
    const nc = normalizeCell(c, recurse);
    if (nc !== c) changed = true;
    return nc;
  });
  return changed ? { ...row, cells } : row;
}

registerCoreBlockCapability({
  kind: 'paragraph',
  // Hash the NORMALIZED runs so a normalization-equivalent untouched paragraph is not seen as
  // edited (comprehensive 3.10).
  hashContent: (block) => {
    const p = block as ParagraphRecord;
    return { kind: 'paragraph', runs: normalizeRuns(p.runs), ...(p.props ? { props: p.props } : {}) };
  },
  normalize: (block) => normalizeParagraph(block as ParagraphRecord),
});

registerCoreBlockCapability({
  kind: 'sdt',
  hashContent: (block, recurse) => {
    const s = block as SdtRecord;
    return { kind: 'sdt', props: s.props, blocks: s.blocks.map(recurse) };
  },
  normalize: (block, recurse) => {
    const s = block as SdtRecord;
    const blocks = recurse(s.blocks);
    return blocks === s.blocks ? s : { ...s, blocks };
  },
});

registerCoreBlockCapability({
  kind: 'table',
  hashContent: (block, recurse) => {
    const t = block as TableRecord;
    return {
      kind: 'table',
      ...(t.grid ? { grid: t.grid } : {}),
      ...(t.props ? { props: t.props } : {}),
      rows: t.rows.map((r) => ({
        ...(r.props ? { props: r.props } : {}),
        cells: r.cells.map((c) => ({
          ...(c.props ? { props: c.props } : {}),
          blocks: c.blocks.map(recurse),
        })),
      })),
    };
  },
  normalize: (block, recurse) => {
    const t = block as TableRecord;
    let changed = false;
    const rows = t.rows.map((r) => {
      const nr = normalizeRow(r, recurse);
      if (nr !== r) changed = true;
      return nr;
    });
    return changed ? { ...t, rows } : t;
  },
});

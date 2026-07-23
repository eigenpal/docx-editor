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
import type { IdentityAllocator } from './identity.ts';
import { normalizeRuns } from './normalize-runs.ts';

export type BlockKind = Block['kind']; // 'paragraph' | 'table' | 'sdt'

/** Normalize a nested block list through the registry (passed to a container capability so it
 *  never re-implements paragraph/table/SDT handling). Returns the SAME reference when unchanged. */
export type RecurseNormalize = (blocks: readonly Block[]) => readonly Block[];
/** Hash a nested block (passed to a container capability's hashContent). */
export type RecurseHash = (block: Block) => unknown;

/** A byte-range replacement within a preserved part (the smallest owned range regenerated for an
 *  edited block; other bytes stay verbatim). */
export interface BlockPatch {
  readonly start: number;
  readonly end: number;
  readonly xml: string;
}

/** What an edited-block patcher needs: the current (edited) model block, the block reparsed from
 *  the ORIGINAL source slice (the baseline), that slice's text, and its absolute byte range. */
export interface PatchContext {
  readonly block: Block;
  readonly reparsed: Block;
  readonly sliceText: string;
  readonly rangeStart: number;
  readonly rangeEnd: number;
}

/** The core operations one block kind contributes. Each is optional at registration so different
 *  layers can add their part; a caller fetching a missing op gets a clear error. */
/** Parse a top-level block element into an authored Block. The element node is typed `unknown` to
 *  keep the model layer free of the package XML reader's types; the package-side registration casts
 *  it. Keyed by OOXML element name (a kind may parse from more than one element). */
export type BlockElementParser = (element: unknown, alloc: IdentityAllocator) => Block;

export interface CoreBlockCapability {
  readonly kind: BlockKind;
  /** Identity-stripped content view for the preservation content hash. */
  readonly hashContent?: (block: Block, recurse: RecurseHash) => unknown;
  /** Canonicalized block (idempotent). */
  readonly normalize?: (block: Block, recurse: RecurseNormalize) => Block;
  /** Regenerate the block's WordprocessingML (throws if it is not byte-faithfully regenerable). */
  readonly serialize?: (block: Block) => string;
  /** Regenerate the SMALLEST owned byte-range(s) for an EDITED block, leaving every other byte
   *  verbatim (preservation ownership). Throws to fail closed when the edit is not byte-faithfully
   *  patchable (unmodeled content, a structural/kind change). */
  readonly patchEdited?: (ctx: PatchContext) => readonly BlockPatch[];
  /** Edit policy (design decision 3). `topLevelEditable` = this kind may be semantically edited as
   *  a top-level body block; a non-editable kind is preserved read-only (never regenerated
   *  structurally). Defaults to non-editable when a kind omits it. */
  readonly editPolicy?: { readonly topLevelEditable: boolean };
  /** The DocOp ids this kind OWNS as semantic operations (comprehensive 3.2). Declares the edit
   *  vocabulary a kind participates in; a completeness check (comprehensive 3.9) can require an
   *  editable kind to name real semantic operations rather than none. */
  readonly semanticOps?: readonly string[];
  /** The nested body blocks a CONTAINER kind holds (a table's cell blocks, an SDT's content);
   *  empty for a leaf. Enables generic identity traversal / counting (comprehensive 3.2 scan/count
   *  + identity traversal) without a central switch. Defaults to no nested blocks. */
  readonly nestedBlocks?: (block: Block) => readonly Block[];
}

const registry = new Map<BlockKind, CoreBlockCapability>();
/** The PARSE lane, folded into this one registry module so there is no SEPARATE global parser Map
 *  elsewhere (registry unification). Keyed by OOXML root element name. */
const blockParsers = new Map<string, BlockElementParser>();

/** Register (or AUGMENT) a block kind's core capability. Additive across DIFFERENT ops (the model
 *  layer contributes hash+normalize, the package layer serialize+patch), but re-registering an op a
 *  kind ALREADY owns is rejected — duplicate operation ownership is a bug (design decision 1: one
 *  owner per capability op), not a silent global override. */
export function registerCoreBlockCapability(cap: CoreBlockCapability): void {
  const prev = registry.get(cap.kind);
  if (prev) {
    for (const key of Object.keys(cap) as (keyof CoreBlockCapability)[]) {
      if (key !== 'kind' && cap[key] !== undefined && prev[key] !== undefined) {
        throw new Error(`duplicate core block capability op '${String(key)}' for kind '${cap.kind}'`);
      }
    }
  }
  registry.set(cap.kind, { ...prev, ...cap, kind: cap.kind });
}

/** Register the parser for a top-level block element name (the parse lane of a block feature). */
export function registerBlockElementParser(elementName: string, parse: BlockElementParser): void {
  blockParsers.set(elementName, parse);
}
/** The registered parser for a block element name, if any. */
export const blockElementParser = (elementName: string): BlockElementParser | undefined => blockParsers.get(elementName);

function opFor<K extends keyof CoreBlockCapability>(kind: BlockKind, op: K): NonNullable<CoreBlockCapability[K]> {
  const cap = registry.get(kind);
  const fn = cap?.[op];
  if (!fn) throw new Error(`no core block capability '${String(op)}' registered for block kind '${kind}'`);
  return fn as NonNullable<CoreBlockCapability[K]>;
}

/** Parse a top-level block element by its root element name through the unified registry, or
 *  undefined for an unregistered element (caller fails closed). */
export const blockParseElement = (elementName: string, element: unknown, alloc: IdentityAllocator): Block | undefined =>
  blockParsers.get(elementName)?.(element, alloc);

export const blockHashContent = (block: Block, recurse: RecurseHash): unknown => opFor(block.kind, 'hashContent')(block, recurse);
export const blockNormalize = (block: Block, recurse: RecurseNormalize): Block => opFor(block.kind, 'normalize')(block, recurse);
export const blockSerialize = (block: Block): string => opFor(block.kind, 'serialize')(block);
export const blockPatchEdited = (ctx: PatchContext): readonly BlockPatch[] => opFor(ctx.block.kind, 'patchEdited')(ctx);
export const hasBlockSerialize = (kind: BlockKind): boolean => !!registry.get(kind)?.serialize;
/** Whether a block kind may be semantically edited as a top-level body block (design decision 3).
 *  A kind with no declared policy is treated as non-editable (preserved read-only), so a new kind
 *  is safe by default until it registers real editable handlers. */
export const isTopLevelEditable = (kind: BlockKind): boolean => registry.get(kind)?.editPolicy?.topLevelEditable === true;
/** The DocOp ids a block kind owns as semantic operations (empty if it declares none). */
export const blockSemanticOps = (kind: BlockKind): readonly string[] => registry.get(kind)?.semanticOps ?? [];
/** Every block kind that has registered any capability. */
export const registeredBlockKinds = (): BlockKind[] => [...registry.keys()];
/** Whether a kind has registered a given kind-keyed core op (parse is element-keyed, not per-kind). */
export function blockCapabilityHas(kind: BlockKind, op: keyof CoreBlockCapability): boolean {
  return registry.get(kind)?.[op] !== undefined;
}
/** Whether ANY element parser is registered (the parse lane is populated). */
export const hasAnyBlockParser = (): boolean => blockParsers.size > 0;
/** The nested body blocks a block holds (empty for a leaf kind). */
export const blockNestedBlocks = (block: Block): readonly Block[] => registry.get(block.kind)?.nestedBlocks?.(block) ?? [];
/** Walk a block and all its descendants (pre-order) through the registry — no central switch. */
export function walkBlockTree(blocks: readonly Block[], visit: (block: Block) => void): void {
  for (const b of blocks) {
    visit(b);
    walkBlockTree(blockNestedBlocks(b), visit);
  }
}

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
  editPolicy: { topLevelEditable: true }, // paragraphs are the editable top-level block kind
  // The semantic edit vocabulary the paragraph kind owns (the DocOp ids that create/edit
  // paragraphs). A container/read-only kind owns none until it registers real handlers.
  semanticOps: [
    'setParagraphRuns',
    'insertText',
    'splitParagraph',
    'joinParagraphs',
    'insertParagraph',
    'appendParagraph',
    'replaceParagraph',
    'deleteParagraph',
  ],
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
  nestedBlocks: (block) => (block as SdtRecord).blocks,
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
  nestedBlocks: (block) => (block as TableRecord).rows.flatMap((r) => r.cells.flatMap((c) => c.blocks)),
});

import { tableTextStructureUnchanged } from './table-text-change.ts';
import { carryBlockMetadataIdentity } from './block-metadata-identity.ts';
import { editableTableParagraph } from './table-ordinary-paragraph.ts';
import {
  firstRowContentDeps,
  cutRowContentDeps,
  lastRowContentDeps,
} from './table-fragment-content-insets.ts';
import { bodyLineId } from './body-line-id.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { drawingInputsUnchangedByTextEdit } from './drawing-text-only-change.ts';
import { readTableStructure, type SemanticTableStructure } from './semantic-table.ts';
import { autofitContextOf } from './table-autofit-widths.ts';
import {
  initialCellCursors,
  layoutRowFragmentBounded,
  type TableFlowDeps,
  type CellPlaceCursor,
} from './semantic-table-layout.ts';
import { finalizeTableRows } from './table-fragment-finalize.ts';
import { isOutOfFlowFragment } from './fragment-flow.ts';
import { updateTableWidths, type TablePageBand } from './table-width-update.ts';
import { finalizedWithHeadroom, withBudgetProof } from './table-budget-proof.ts';
import { registerEditedTableCellBreakKeys } from './table-cell-break-keys.ts';
import type {
  BlockFragmentRecord,
  PageRecord,
  TableRowFragmentRecord,
} from './semantic-records.ts';

/** Re-place an ordinary complete row only when its flow extent stays unchanged. */
export function updateTableText(
  before: OoxmlElement,
  after: OoxmlElement,
  pages: readonly PageRecord[],
  width: number,
  deps: TableFlowDeps,
  /** The paginator's body band per page; a width change may grow a row only within it. */
  pageBand?: TablePageBand
): {
  pages: readonly PageRecord[];
  lineDelta: number;
  replacements: ReadonlyMap<BlockFragmentRecord, BlockFragmentRecord>;
  paragraphPagesUnchanged?: true;
  /** The structure the updated pages now come from, when only one row's text changed. */
  textStructure?: SemanticTableStructure;
} | null {
  if (!tableTextStructureUnchanged(before, after)) return null;
  const structureOf = (table: OoxmlElement) =>
    readTableStructure(
      table,
      width,
      0,
      deps.styleCascade,
      deps.displayMode,
      deps.revisionAuthorFilter,
      deps.compatibilityMode,
      autofitContextOf(deps)
    );
  const oldStructure = structureOf(before);
  const structure = structureOf(after);
  if (!oldStructure || !structure || structure.float) return null;
  if (oldStructure.rows.length !== structure.rows.length) return null;
  if (JSON.stringify(oldStructure.columnWidthsPt) !== JSON.stringify(structure.columnWidthsPt)) {
    const update = updateTableWidths(after, oldStructure, structure, pages, width, deps, pageBand);
    // Carry attribution metadata only when existing text values changed. New revision
    // wrappers require fresh metadata even when the row keeps its page.
    if (update && drawingInputsUnchangedByTextEdit(before, after))
      for (let index = 0; index < pages.length; index++) {
        const previous = pages[index]!.fragments;
        const next = update.pages[index]!.fragments;
        if (previous !== next) carryBlockMetadataIdentity(previous, next);
      }
    return update;
  }
  const changed = structure.rows.filter((row, i) => row !== oldStructure.rows[i]);
  if (changed.length !== 1) return null;
  const source = changed[0]!;
  const oldSource = oldStructure.rows[structure.rows.indexOf(source)]!;
  // A continued merge cell holds no content and keeps its finalized record. A merge head is
  // placed here like any cell: one row's placement lets its content raise the row, so a head
  // whose content stays within its own row places as the full layout did, and a taller one
  // changes the row height and takes the full layout. A head is not detached from its row
  // here: the full layout detaches it only when its span is admitted at that place, which the
  // finalized records do not keep. Its finalized box spans the merge, so only its blocks are
  // compared and replaced.
  const continued = new Set<number>();
  const heads = new Set<number>();
  source.cells.forEach((cell, index) => {
    if (cell.vMergeContinue) continued.add(index);
    else if (cell.headsVerticalMerge) heads.add(index);
  });
  // Cell counts match (checked below), so every index has an old cell.
  const edited = (index: number) => {
    const oldBlocks = oldSource.cells[index]!.blocks;
    const newBlocks = source.cells[index]!.blocks;
    return newBlocks.length !== oldBlocks.length || newBlocks.some((b, i) => b !== oldBlocks[i]);
  };
  if (
    source.isHeader ||
    // An exact row clips a head placed in it, while the full layout may detach the head and
    // let its content run through the rows of its span. The clip hides which one applies.
    (heads.size > 0 && source.height.rule === 'exact') ||
    oldSource.cells.length !== source.cells.length ||
    source.cells.some((c, index) => {
      const old = oldSource.cells[index]!;
      if (old.vMergeContinue !== c.vMergeContinue || !!old.headsVerticalMerge !== heads.has(index))
        return true;
      if (continued.has(index)) return edited(index);
      return (
        c.textDirection !== 'horizontal' ||
        c.blocks.some(
          (b) => b.kind !== 'paragraph' || !editableTableParagraph(b) || deps.listItems?.has(b.id)
        )
      );
    })
  )
    return null;
  const occurrences: {
    page: PageRecord;
    fragment: Extract<BlockFragmentRecord, { kind: 'table' }>;
    index: number;
  }[] = [];
  for (const page of pages)
    for (const fragment of page.fragments) {
      if (fragment.kind !== 'table' || fragment.tableId !== after.id) continue;
      for (let index = 0; index < fragment.rows.length; index++)
        if (fragment.rows[index]!.id === source.id) occurrences.push({ page, fragment, index });
    }
  if (occurrences.length === 0 || occurrences.length > 4096) return null;
  // Where a row that may split breaks, or whether it starts on a page at all, the paginator
  // decides from the lines of every cell (`rowFollowsBelow`, cell widow control), not from
  // the row's height. A text edit can change that decision, so such a row is laid out again
  // when it splits, when it opens a fragment at the top of its column (it may have moved
  // there from the page before), or when it ends a fragment the table continues past: there
  // it must also leave room for its own closing edge (`closingEdgePt`), and when it does not,
  // the paginator splits it or moves it by the lines of its cells. A row placed whole between
  // other rows of its page keeps its height, so it still fits whole there. A table that opens
  // the document has no page before it.
  const splits = !source.cantSplit && source.height.rule !== 'exact';
  const opensDocument =
    deps.documentFirstParagraphId !== undefined &&
    structure.rows[0]?.cells[0]?.blocks[0]?.id === deps.documentFirstParagraphId &&
    occurrences[0]!.page === pages[0];
  if (
    splits &&
    (occurrences.length > 1 ||
      (!opensDocument && mayHaveMoved(occurrences[0]!)) ||
      endsContinuedFragment(occurrences[0]!, pages, after.id))
  )
    return null;
  const oldKeys = new Set<string>();
  const newKeys = new Set<string>();
  const replacements = new Map<BlockFragmentRecord, BlockFragmentRecord>();
  let oldCursors: readonly CellPlaceCursor[] = initialCellCursors(oldSource);
  let newCursors: readonly CellPlaceCursor[] = initialCellCursors(source);
  let lineDelta = 0;
  for (let occurrenceIndex = 0; occurrenceIndex < occurrences.length; occurrenceIndex++) {
    const { page, fragment, index } = occurrences[occurrenceIndex]!;
    const oldRow = fragment.rows[index]!;
    const continues = occurrenceIndex + 1 < occurrences.length;
    if (
      !!oldRow.isContinuation !== occurrenceIndex > 0 ||
      !!oldRow.hasContinuation !== continues ||
      page.anchoredDrawings?.length ||
      // Borders and merge spans stay as finalized; a spent pass budget could have cut them.
      !finalizedWithHeadroom(fragment) ||
      oldRow.cells.length !== source.cells.length ||
      oldRow.cells.some(
        (c, i) =>
          c.vMergeContinue !== continued.has(i) ||
          ((c.rowSpan ?? 1) !== 1) !== heads.has(i) ||
          index + (c.rowSpan ?? 1) > fragment.rows.length
      )
    )
      return null;
    const baseDeps = index === 0 ? firstRowContentDeps(structure, source, deps) : deps;
    // The paginator places the first part of a split row with the rule at the cut, and only so.
    const candidates =
      continues && occurrenceIndex === 0
        ? [cutRowContentDeps(structure, source, baseDeps)]
        : index === fragment.rows.length - 1
          ? [lastRowContentDeps(structure, source, baseDeps), baseDeps]
          : [baseDeps];
    const place = (
      row: typeof source,
      keys: Set<string>,
      placementDeps: TableFlowDeps,
      cursors: readonly CellPlaceCursor[]
    ) => {
      const placed = layoutRowFragmentBounded(
        row,
        structure.columnWidthsPt,
        fragment.box.x,
        oldRow.box.y,
        oldRow.box.y + oldRow.box.height,
        false,
        occurrenceIndex > 0,
        0,
        {
          ...placementDeps,
          pageExclusionZones: undefined,
          nextLineId: bodyLineId,
          onCellBreakKey: (key) => keys.add(key),
        },
        cursors,
        structure.cellSpacingPt
      );
      if (
        !!placed.remainder !== continues ||
        !placed.fitted ||
        Math.abs(placed.record.box.height - oldRow.box.height) > 0.001
      )
        return null;
      const record = continues
        ? { ...placed.record, hasContinuation: true as const }
        : placed.record;
      const finalized = finalizeTableRows(
        [record],
        structure,
        [row],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        placementDeps.cellContentInsets
          ? new Map([[record, placementDeps.cellContentInsets]])
          : undefined
      )[0]!;
      if (
        finalized.cells.some(
          (cell, i) =>
            !continued.has(i) &&
            !heads.has(i) &&
            JSON.stringify(cell.box) !== JSON.stringify(oldRow.cells[i]?.box)
        )
      )
        return null;
      return { finalized, remainder: placed.remainder };
    };
    // The old row tells which placement the paginator used only when one candidate gives it.
    // When several do, the new row must place the same under each, or the choice is unknown.
    let matched: { remainder: readonly CellPlaceCursor[] | null } | undefined;
    let result: ReturnType<typeof place> | undefined;
    for (const candidate of candidates) {
      const old = place(oldSource, oldKeys, candidate, oldCursors);
      if (
        !old?.finalized.cells.every(
          (cell, i) =>
            continued.has(i) ||
            JSON.stringify(cell.blocks) === JSON.stringify(oldRow.cells[i]!.blocks)
        )
      )
        continue;
      // Only the placement kept registers its cell break keys.
      const placed = place(source, result ? new Set() : newKeys, candidate, newCursors);
      if (!placed) return null;
      if (result && !samePlacedBlocks(result.finalized, placed.finalized, continued)) return null;
      matched ??= { remainder: old.remainder };
      result ??= placed;
    }
    if (!matched || !result) return null;
    oldCursors = matched.remainder ?? [];
    newCursors = result.remainder ?? [];
    const finalized = result.finalized;
    const lineCount = (blocks: readonly BlockFragmentRecord[]) =>
      blocks.reduce((n, b) => n + (b.kind === 'paragraph' ? b.lines.length : 0), 0);
    lineDelta += finalized.cells.reduce(
      (sum, cell, index) =>
        continued.has(index)
          ? sum
          : sum + lineCount(cell.blocks) - lineCount(oldRow.cells[index]!.blocks),
      0
    );
    // Keep stable line ids from the regular body placement convention.
    const cells = oldRow.cells.map((cell, i) =>
      continued.has(i) ? cell : { ...cell, blocks: finalized.cells[i]!.blocks }
    );
    const row = { ...oldRow, cells };
    const prior = replacements.get(fragment) as typeof fragment | undefined;
    const replacement = {
      ...fragment,
      rows: (prior ?? fragment).rows.map((r, i) => (i === index ? row : r)),
    };
    replacements.set(fragment, withBudgetProof(replacement, true));
  }
  // `before`'s keys without the old row's, then the new row's, sharing untouched chunks.
  registerEditedTableCellBreakKeys(after, before, oldKeys, newKeys);
  return {
    lineDelta,
    textStructure: structure,
    pages: pages.map((p) =>
      p.fragments.some((f) => replacements.has(f))
        ? { ...p, fragments: p.fragments.map((f) => replacements.get(f) ?? f) }
        : p
    ),
    replacements,
  };
}

function samePlacedBlocks(
  a: TableRowFragmentRecord,
  b: TableRowFragmentRecord,
  continued: ReadonlySet<number>
): boolean {
  return a.cells.every(
    (cell, i) =>
      continued.has(i) || JSON.stringify(cell.blocks) === JSON.stringify(b.cells[i]?.blocks)
  );
}

/** Whether the row at `index` ends `fragment` and the next page goes on with the table. */
function endsContinuedFragment(
  at: {
    readonly page: PageRecord;
    readonly fragment: Extract<BlockFragmentRecord, { kind: 'table' }>;
    readonly index: number;
  },
  pages: readonly PageRecord[],
  tableId: string
): boolean {
  if (at.index !== at.fragment.rows.length - 1) return false;
  const next = pages[pages.indexOf(at.page) + 1];
  return next?.fragments.some((f) => f.kind === 'table' && f.tableId === tableId) === true;
}

/**
 * Whether the row at `index` of `fragment` opens the fragment at the top of its column, where
 * the paginator may have moved it from an earlier page. The rows above it in the fragment are
 * only header rows, and no in-flow block above it on the page shares its column.
 */
function mayHaveMoved(at: {
  readonly page: PageRecord;
  readonly fragment: Extract<BlockFragmentRecord, { kind: 'table' }>;
  readonly index: number;
}): boolean {
  const { page, fragment, index } = at;
  for (let row = 0; row < index; row += 1) {
    const placed = fragment.rows[row]!;
    if (!placed.isHeaderRepeat && !placed.isHeaderRow) return false;
  }
  const { x, y, width } = fragment.box;
  // Multi-column sections never reach this path (`semantic-layout.ts` requires one column), so
  // the column test is defensive.
  return !page.fragments.some(
    (other) =>
      other !== fragment &&
      !isOutOfFlowFragment(other) &&
      other.box.y + other.box.height <= y + 0.001 &&
      other.box.x < x + width &&
      other.box.x + other.box.width > x
  );
}

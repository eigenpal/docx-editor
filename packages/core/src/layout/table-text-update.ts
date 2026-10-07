import { carryBlockMetadataIdentity } from './block-metadata-identity.ts';
import { ordinaryTableParagraph } from './table-ordinary-paragraph.ts';
import { firstRowContentDeps, lastRowContentDeps } from './table-fragment-content-insets.ts';
import { bodyLineId } from './body-line-id.ts';
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { drawingInputsUnchangedByTextEdit } from './drawing-text-only-change.ts';
import { readTableStructure } from './semantic-table.ts';
import { autofitContextOf } from './table-autofit-widths.ts';
import {
  initialCellCursors,
  layoutRowFragmentBounded,
  type TableFlowDeps,
  type CellPlaceCursor,
} from './semantic-table-layout.ts';
import { finalizeTableRows } from './table-fragment-finalize.ts';
import { updateTableWidths } from './table-width-update.ts';
import { finalizedWithHeadroom, withBudgetProof } from './table-budget-proof.ts';
import { tableCellBreakKeysOf, registerTableCellBreakKeys } from './layout-cache.ts';
import type { BlockFragmentRecord, PageRecord } from './semantic-records.ts';

/** Re-place an ordinary complete row only when its flow extent stays unchanged. */
export function updateTableText(
  before: OoxmlElement,
  after: OoxmlElement,
  pages: readonly PageRecord[],
  width: number,
  deps: TableFlowDeps
): {
  pages: readonly PageRecord[];
  lineDelta: number;
  replacements: ReadonlyMap<BlockFragmentRecord, BlockFragmentRecord>;
  paragraphPagesUnchanged?: true;
} | null {
  if (!drawingInputsUnchangedByTextEdit(before, after)) return null;
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
    const update = updateTableWidths(after, oldStructure, structure, pages, width, deps);
    // The width lane requires ordinaryTableParagraph, which excludes revision markup and
    // drawings. The text-only source proof preserves cell properties and shading authors.
    // Unchanged page membership then preserves attribution order and drawing presence.
    if (update)
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
  if (
    source.isHeader ||
    source.cells.some(
      (c) =>
        c.vMergeContinue ||
        c.textDirection !== 'horizontal' ||
        c.blocks.some(
          (b) => b.kind !== 'paragraph' || !ordinaryTableParagraph(b) || deps.listItems?.has(b.id)
        )
    )
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
  const oldKeys = new Set<string>();
  const newKeys = new Set<string>();
  const oldSource = oldStructure.rows[structure.rows.indexOf(source)]!;
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
      oldRow.cells.some((c) => c.rowSpan !== 1 || c.vMergeContinue)
    )
      return null;
    const baseDeps = index === 0 ? firstRowContentDeps(structure, source, deps) : deps;
    const candidates =
      index === fragment.rows.length - 1
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
          (cell, i) => JSON.stringify(cell.box) !== JSON.stringify(oldRow.cells[i]?.box)
        )
      )
        return null;
      return { finalized, remainder: placed.remainder };
    };
    let matched: { deps: TableFlowDeps; remainder: readonly CellPlaceCursor[] | null } | undefined;
    for (const candidate of candidates) {
      const old = place(oldSource, oldKeys, candidate, oldCursors);
      if (
        old?.finalized.cells.every(
          (cell, i) => JSON.stringify(cell.blocks) === JSON.stringify(oldRow.cells[i]!.blocks)
        )
      ) {
        matched = { deps: candidate, remainder: old.remainder };
        break;
      }
    }
    if (!matched) return null;
    const result = place(source, newKeys, matched.deps, newCursors);
    if (!result) return null;
    oldCursors = matched.remainder ?? [];
    newCursors = result.remainder ?? [];
    const finalized = result.finalized;
    const lineCount = (blocks: readonly BlockFragmentRecord[]) =>
      blocks.reduce((n, b) => n + (b.kind === 'paragraph' ? b.lines.length : 0), 0);
    lineDelta += finalized.cells.reduce(
      (sum, cell, index) => sum + lineCount(cell.blocks) - lineCount(oldRow.cells[index]!.blocks),
      0
    );
    // Keep stable line ids from the regular body placement convention.
    const cells = oldRow.cells.map((cell, i) => ({ ...cell, blocks: finalized.cells[i]!.blocks }));
    const row = { ...oldRow, cells };
    const prior = replacements.get(fragment) as typeof fragment | undefined;
    const replacement = {
      ...fragment,
      rows: (prior ?? fragment).rows.map((r, i) => (i === index ? row : r)),
    };
    replacements.set(fragment, withBudgetProof(replacement, true));
  }
  registerTableCellBreakKeys(after, [
    ...(tableCellBreakKeysOf(before) ?? []).filter((key) => !oldKeys.has(key)),
    ...newKeys,
  ]);
  return {
    lineDelta,
    pages: pages.map((p) =>
      p.fragments.some((f) => replacements.has(f))
        ? { ...p, fragments: p.fragments.map((f) => replacements.get(f) ?? f) }
        : p
    ),
    replacements,
  };
}

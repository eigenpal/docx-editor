import type { OoxmlNode } from '@docx-editor.dev/core/store';
import type { SemanticTableStructure } from './semantic-table.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import { drawingInputsUnchangedByTextEdit } from './drawing-text-only-change.ts';
import { mergedFlowBlocks } from './story-roots.ts';

interface Context {
  readonly contentWidthPt: number;
  readonly depth: number;
  readonly styleCascade: StyleCascadeTable | undefined;
  readonly displayMode: RevisionDisplayMode;
  readonly authorFilter: RevisionAuthorFilter | undefined;
  readonly compatibilityMode: number | undefined;
}
interface Memo extends Context {
  readonly table: OoxmlNode;
  readonly structure: SemanticTableStructure | null;
}
function sameContext(a: Context, b: Context): boolean {
  return (
    a.contentWidthPt === b.contentWidthPt &&
    a.depth === b.depth &&
    a.styleCascade === b.styleCascade &&
    a.displayMode === b.displayMode &&
    a.authorFilter === b.authorFilter &&
    a.compatibilityMode === b.compatibilityMode
  );
}

/** Reuse resolved table geometry only when an immutable edit changes ordinary text. */
function createStructureCache() {
  const roots = new WeakMap<OoxmlNode, Memo[]>();
  // Immutable table properties survive ordinary text edits. Keep reviewer views separate.
  const latest = new WeakMap<OoxmlNode, Memo[]>();
  const rememberLatest = (owner: OoxmlNode, memo: Memo): void => {
    const entries = latest.get(owner) ?? [];
    const index = entries.findIndex((entry) => sameContext(entry, memo));
    if (index >= 0) entries[index] = memo;
    else {
      if (entries.length === 4) entries.shift();
      entries.push(memo);
    }
    latest.set(owner, entries);
  };
  return function cachedTableStructure(
    table: OoxmlNode,
    context: Context,
    read: () => SemanticTableStructure | null
  ): SemanticTableStructure | null {
    const entries = roots.get(table) ?? [];
    const known = entries.find((entry) => sameContext(entry, context));
    const owner =
      table.kind === 'table' ? table.children.find((n) => n.localName === 'tblPr') : undefined;
    if (known) {
      if (owner) rememberLatest(owner, known);
      return known.structure;
    }
    const previous = owner
      ? latest.get(owner)?.find((entry) => sameContext(entry, context))
      : undefined;
    let structure: SemanticTableStructure | null | undefined;
    if (
      previous?.structure &&
      sameContext(previous, context) &&
      drawingInputsUnchangedByTextEdit(previous.table, table)
    ) {
      const cells = new Map<string, OoxmlNode>();
      const visit = (before: OoxmlNode, after: OoxmlNode): void => {
        if (before === after || before.kind === 'textValue' || after.kind === 'textValue') return;
        if (after.kind === 'tableCell') {
          cells.set(after.id, after);
          return;
        }
        for (let i = 0; i < before.children.length; i++)
          visit(before.children[i]!, after.children[i]!);
      };
      visit(previous.table, table);
      structure = {
        ...previous.structure,
        rows: previous.structure.rows.map((row) => {
          if (!row.cells.some((cell) => cells.has(cell.id))) return row;
          return {
            ...row,
            cells: row.cells.map((cell) => {
              const node = cells.get(cell.id);
              return node && node.kind !== 'textValue'
                ? {
                    ...cell,
                    blocks: mergedFlowBlocks(
                      node.children,
                      context.displayMode,
                      context.authorFilter
                    ),
                  }
                : cell;
            }),
          };
        }),
      };
    }
    structure ??= read();
    const memo = { ...context, table, structure };
    // Keep common reviewer views independent without retaining unbounded width variants.
    if (entries.length === 4) entries.shift();
    entries.push(memo);
    roots.set(table, entries);
    if (owner) rememberLatest(owner, memo);
    return structure;
  };
}
export const cachedTableStructure = createStructureCache();

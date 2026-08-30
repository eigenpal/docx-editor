// The interop-HTML table renderer — split from clipboard-html-write.ts at the
// max-lines cap. The block renderer and field-state advance are injected, so the
// runtime dependency stays one-way.

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
} from '../store/package/ooxml-tree.ts';
import {
  attrOf,
  escapeAttr,
  isElement,
  parseIntValue,
  ptFromTwips,
  wmlChild,
  wmlVal,
} from './clipboard-html-write-tree.ts';
import { styleChain } from './clipboard-html-write-cascade.ts';
import {
  conditionalCellFill,
  tableConditionalFormats,
  wordTableCellCss,
} from './clipboard-html-write-table-styles.ts';
import { wordBorderCss, wordTableRowCss } from './clipboard-html-word-elements.ts';
import type { FieldState, RenderContext } from './clipboard-html-write.ts';

export interface TableRenderDeps {
  readonly renderBlocks: (
    ctx: RenderContext,
    children: readonly OoxmlNode[],
    sharedFields?: FieldState
  ) => string;
  readonly advanceFieldState: (node: OoxmlElement, fields: FieldState) => void;
}

interface CellPlacement {
  readonly cell: OoxmlElement;
  readonly startColumn: number;
  readonly span: number;
  readonly vMerge: 'restart' | 'continue' | null;
}

/** A typed cell, or a `w:tc` the canonical tree demoted to generic — both occupy a column. */
function isRowCell(child: OoxmlElement): boolean {
  if (child.kind === 'tableCell') return true;
  return child.localName === 'tc' && child.namespaceUri === WML_NAMESPACE_URI;
}

/**
 * Placements plus, per row, the children the cell walk SKIPPED. An SDT-wrapped
 * cell unwraps in place (`w:tc` is a legal `w:sdtContent` child); everything else
 * that never renders still reports back so the caller can advance the shared
 * field state over it — the balance probe counted its fldChars.
 */
function cellPlacementsOf(rows: readonly OoxmlElement[]): {
  placements: CellPlacement[][];
  skipped: OoxmlElement[][];
} {
  const placements: CellPlacement[][] = [];
  const skipped: OoxmlElement[][] = [];
  for (const row of rows) {
    const rowPlacements: CellPlacement[] = [];
    const rowSkipped: OoxmlElement[] = [];
    let column = 0;
    const collect = (children: readonly OoxmlNode[]): void => {
      for (const child of children) {
        if (!isElement(child)) continue;
        if (isRowCell(child)) {
          const tcPr = wmlChild(child, 'tcPr');
          const span = Math.min(
            Math.max(parseIntValue(wmlVal(wmlChild(tcPr, 'gridSpan'))) ?? 1, 1),
            63
          );
          const vMergeNode = wmlChild(tcPr, 'vMerge');
          const vMerge =
            vMergeNode === null ? null : wmlVal(vMergeNode) === 'restart' ? 'restart' : 'continue';
          rowPlacements.push({ cell: child, startColumn: column, span, vMerge });
          column += span;
          continue;
        }
        if (child.kind === 'contentControl') {
          const content = child.children.find((inner) => inner.kind === 'contentControlContent');
          if (content && isElement(content)) collect(content.children);
          continue;
        }
        rowSkipped.push(child);
      }
    };
    collect(row.children);
    placements.push(rowPlacements);
    skipped.push(rowSkipped);
  }
  return { placements, skipped };
}

export function renderHtmlTable(
  ctx: RenderContext,
  table: OoxmlElement,
  fields: FieldState,
  deps: TableRenderDeps
): string {
  const tblPr = table.children.find((child) => child.kind === 'tableProperties');
  const ownTblPr = tblPr && isElement(tblPr) ? tblPr : null;
  let tblBorders: OoxmlElement | null = null;
  const tableStyleChain = styleChain(ctx.styles, wmlVal(wmlChild(ownTblPr, 'tblStyle')));
  for (const style of tableStyleChain) {
    const styleBorders = wmlChild(wmlChild(style, 'tblPr'), 'tblBorders');
    if (styleBorders) tblBorders = styleBorders;
  }
  const ownBorders = wmlChild(ownTblPr, 'tblBorders');
  if (ownBorders) tblBorders = ownBorders;
  const conditionalFormats = tableConditionalFormats(
    tableStyleChain,
    wmlChild(ownTblPr, 'tblLook')
  );

  // A typed row, or a `w:tr` demoted to generic, or a row inside a row-level SDT
  // (the canonical tree types those `contentControl`). Any other child the render
  // skips still advances the shared field state the balance probe counted.
  const rows: OoxmlElement[] = [];
  const collectRows = (children: readonly OoxmlNode[]): void => {
    for (const child of children) {
      if (!isElement(child)) continue;
      if (
        child.kind === 'tableRow' ||
        (child.localName === 'tr' && child.namespaceUri === WML_NAMESPACE_URI)
      ) {
        rows.push(child);
        continue;
      }
      if (child.kind === 'contentControl') {
        const content = child.children.find((inner) => inner.kind === 'contentControlContent');
        if (content && isElement(content)) collectRows(content.children);
        continue;
      }
      deps.advanceFieldState(child, fields);
    }
  };
  collectRows(table.children);
  const { placements, skipped: skippedByRow } = cellPlacementsOf(rows);

  const tableRules = ['border-collapse:collapse'];
  const tableWidth = wmlChild(ownTblPr, 'tblW');
  const width = parseIntValue(attrOf(tableWidth, 'w', WML_NAMESPACE_URI));
  if (width !== null && width > 0 && attrOf(tableWidth, 'type', WML_NAMESPACE_URI) === 'dxa') {
    tableRules.push(`width:${ptFromTwips(width)}`);
  }
  const tableJc = wmlVal(wmlChild(ownTblPr, 'jc'));
  if (tableJc === 'center') tableRules.push('margin-left:auto', 'margin-right:auto');
  else if (tableJc === 'right') tableRules.push('margin-left:auto', 'margin-right:0');
  for (const [xmlName, cssName] of [
    ['insideH', 'insideh'],
    ['insideV', 'insidev'],
  ] as const) {
    const border = wordBorderCss(wmlChild(tblBorders, xmlName));
    if (border) tableRules.push(`mso-border-${cssName}-alt:${border}`);
  }
  // Outer-vs-inside edges classify by GRID COLUMN, not placement index: a ragged
  // short row's last cell sits mid-grid and must take the inside border.
  let gridColumns = 1;
  for (const rowCells of placements) {
    for (const placement of rowCells) {
      gridColumns = Math.max(gridColumns, placement.startColumn + placement.span);
    }
  }
  let out = `<table style="${tableRules.join(';')}">`;
  placements.forEach((rowCells, rowIndex) => {
    // Skipped row children never render, but their fldChars still drive the state.
    for (const node of skippedByRow[rowIndex] ?? []) deps.advanceFieldState(node, fields);
    const height = wmlChild(wmlChild(rows[rowIndex] ?? null, 'trPr'), 'trHeight');
    const heightValue = parseIntValue(attrOf(height, 'val', WML_NAMESPACE_URI));
    const rowCss = wordTableRowCss(heightValue, attrOf(height, 'hRule', WML_NAMESPACE_URI));
    const rowStyle = rowCss === '' ? '' : ` style="${rowCss}"`;
    out += `<tr${rowStyle}>`;
    for (const placement of rowCells) {
      if (placement.vMerge === 'continue') {
        // The continuation cell renders nothing, but its fldChars still drive the
        // shared field state — the same rule as tracked deletions.
        deps.advanceFieldState(placement.cell, fields);
        continue;
      }
      let rowSpan = 1;
      if (placement.vMerge === 'restart') {
        for (let below = rowIndex + 1; below < placements.length; below += 1) {
          const continuation = placements[below]!.find(
            (candidate) =>
              candidate.startColumn === placement.startColumn && candidate.vMerge === 'continue'
          );
          if (!continuation) break;
          rowSpan += 1;
        }
      }
      const tcPr = wmlChild(placement.cell, 'tcPr');
      const css = wordTableCellCss(
        tcPr,
        tblBorders,
        rowIndex,
        placements.length,
        rowSpan,
        placement.startColumn === 0,
        placement.startColumn + placement.span >= gridColumns,
        conditionalCellFill(conditionalFormats, rowIndex, placement.startColumn === 0)
      );
      const attrs =
        (placement.span > 1 ? ` colspan="${placement.span}"` : '') +
        (rowSpan > 1 ? ` rowspan="${rowSpan}"` : '') +
        (css === '' ? '' : ` style="${escapeAttr(css)}"`);
      out += `<td${attrs}>${deps.renderBlocks(ctx, placement.cell.children, fields)}</td>`;
    }
    out += '</tr>';
  });
  return `${out}</table>`;
}

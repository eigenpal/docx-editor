// The external-HTML table walk — split from clipboard-html-read.ts at the max-lines
// cap. The block-flow recursion is injected, so the runtime dependency stays one-way.

import {
  cellCssPropertiesXml,
  htmlSpanOf,
  tableBordersXml,
  tableColumnWidths,
  tableJustification,
  tablePositionXml,
  tableRowsOf,
  tableRowPropertiesXml,
  tableSpanWidth,
  tableWidthTwips,
} from './clipboard-html-table-styles.ts';
import { tagOf } from './clipboard-html-styles.ts';
import type { FlowContext, Projection } from './clipboard-html-read.ts';

const TABLE_TOTAL_TWIPS = 9360; // 6.5 inches, Word's default content width.

type RowSpanCarry = { remaining: number; readonly span: number };

type ProjectFlow = (
  nodes: readonly Node[],
  depth: number,
  ctx: FlowContext,
  p: Projection,
  out: string[],
  forceEmit?: boolean
) => void;

export function projectHtmlTable(
  table: Element,
  depth: number,
  ctx: FlowContext,
  p: Projection,
  out: string[],
  projectFlow: ProjectFlow
): void {
  if (p.nodesLeft <= 0) {
    p.truncated = true;
    return;
  }
  if (depth > p.maxDepth) return;
  p.nodesLeft -= 1;
  const rows = tableRowsOf(table);
  if (rows.length === 0) return;

  // Count columns INCLUDING rowspan carry-over: a row that receives carried columns
  // still owns its trailing cells, which would otherwise be dropped. The pre-count
  // is bounded by its OWN copy of the remaining budget (so a crafted rowspan lattice
  // cannot spin) without consuming the shared budget the emission walk charges.
  let columns = 1;
  let precountLeft = p.nodesLeft;
  const carrySpans: Array<{ remaining: number; span: number }> = [];
  for (const row of rows) {
    if (precountLeft <= 0 || columns >= 63) break;
    let count = 0;
    let keep = 0;
    for (const carried of carrySpans) {
      count += carried.span;
      carried.remaining -= 1;
      if (carried.remaining > 0) carrySpans[keep++] = carried;
    }
    carrySpans.length = keep;
    for (const cell of Array.from(row.children)) {
      precountLeft -= 1;
      if (precountLeft <= 0) break;
      if (!/^t[dh]$/.test(tagOf(cell))) continue;
      const span = htmlSpanOf(cell, 'colspan', 63);
      count += span;
      const rowSpan = htmlSpanOf(cell, 'rowspan', 1000);
      if (rowSpan > 1 && carrySpans.length < 63) {
        carrySpans.push({ remaining: rowSpan - 1, span });
      }
    }
    columns = Math.max(columns, count);
  }
  columns = Math.min(columns, 63);

  const totalWidth = tableWidthTwips(table, TABLE_TOTAL_TWIPS);
  const columnWidths = tableColumnWidths(rows, columns, totalWidth);
  const borders = tableBordersXml(table);
  const position = tablePositionXml(table);
  const justification = tableJustification(table);
  const jc = justification === undefined ? '' : `<w:jc w:val="${justification}"/>`;
  const grid = columnWidths.map((width) => `<w:gridCol w:w="${width}"/>`).join('');

  const carry: Array<RowSpanCarry | null> = new Array<RowSpanCarry | null>(columns).fill(null);
  const rowXml: string[] = [];
  for (const row of rows) {
    if (p.nodesLeft <= 0) {
      p.truncated = true;
      break;
    }
    p.nodesLeft -= 1;
    // Snapshot the carries entering THIS row, then age every entry exactly once —
    // a colspan cell that jumps a carried column must not leave it un-aged.
    const carriedNow: Array<number | null> = carry.map((entry) => (entry ? entry.span : null));
    for (let index = 0; index < columns; index += 1) {
      const entry = carry[index];
      if (entry) {
        entry.remaining -= 1;
        if (entry.remaining <= 0) carry[index] = null;
      }
    }
    const sourceCells = Array.from(row.children).filter((cell) => /^t[dh]$/.test(tagOf(cell)));
    let sourceAt = 0;
    const cells: string[] = [];
    let column = 0;
    while (column < columns) {
      p.nodesLeft -= 1;
      if (p.nodesLeft <= 0) {
        p.truncated = true;
        break;
      }
      const carriedSpan = carriedNow[column];
      if (carriedSpan !== null) {
        const gridSpan = carriedSpan > 1 ? `<w:gridSpan w:val="${carriedSpan}"/>` : '';
        cells.push(
          `<w:tc><w:tcPr>` +
            `<w:tcW w:w="${tableSpanWidth(columnWidths, column, carriedSpan)}" w:type="dxa"/>` +
            `${gridSpan}<w:vMerge/></w:tcPr><w:p/></w:tc>`
        );
        column += carriedSpan;
        continue;
      }
      const cell = sourceCells[sourceAt];
      if (cell === undefined) {
        cells.push(
          `<w:tc><w:tcPr><w:tcW w:w="${columnWidths[column]}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`
        );
        column += 1;
        continue;
      }
      sourceAt += 1;
      const span = Math.min(htmlSpanOf(cell, 'colspan', 63), columns - column);
      const rowSpan = htmlSpanOf(cell, 'rowspan', 1000);
      if (rowSpan > 1) carry[column] = { remaining: rowSpan - 1, span };
      cells.push(
        projectCell(
          cell,
          span,
          tableSpanWidth(columnWidths, column, span),
          rowSpan > 1,
          depth,
          ctx,
          p,
          projectFlow
        )
      );
      column += span;
    }
    rowXml.push(`<w:tr>${tableRowPropertiesXml(row)}${cells.join('')}</w:tr>`);
  }

  out.push(
    `<w:tbl><w:tblPr>${position}<w:tblW w:w="${totalWidth}" w:type="dxa"/>${jc}${borders}</w:tblPr>` +
      `<w:tblGrid>${grid}</w:tblGrid>${rowXml.join('')}</w:tbl>`
  );
  p.lastMarkCovered = false;
}

function projectCell(
  cell: Element,
  span: number,
  width: number,
  vMergeRestart: boolean,
  depth: number,
  ctx: FlowContext,
  p: Projection,
  projectFlow: ProjectFlow
): string {
  const isHeader = tagOf(cell) === 'th';
  let tcPr = `<w:tcW w:w="${width}" w:type="dxa"/>`;
  if (span > 1) tcPr += `<w:gridSpan w:val="${span}"/>`;
  if (vMergeRestart) tcPr += '<w:vMerge w:val="restart"/>';
  tcPr += cellCssPropertiesXml(cell);

  const cellCtx: FlowContext = {
    run: isHeader ? { ...ctx.run, bold: true } : ctx.run,
    para: isHeader ? { jc: 'center' } : {},
    paragraphMarkCovered: false,
    pre: false,
    list: null,
    ...(ctx.noteBody ? { noteBody: ctx.noteBody } : {}),
    ...(ctx.rels ? { rels: ctx.rels } : {}),
  };
  const blocks: string[] = [];
  projectFlow(Array.from(cell.childNodes), depth + 2, cellCtx, p, blocks, true);
  // A cell must end with a paragraph.
  if (blocks.length === 0 || blocks[blocks.length - 1]!.endsWith('</w:tbl>')) {
    blocks.push('<w:p/>');
  }
  return `<w:tc><w:tcPr>${tcPr}</w:tcPr>${blocks.join('')}</w:tc>`;
}

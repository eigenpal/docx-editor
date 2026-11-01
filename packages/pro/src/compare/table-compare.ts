/**
 * Table and block content-control compare.
 *
 * Rows align by their cell text. Matched rows with the same number of cells compare cell by
 * cell; other rows are recorded as a deleted row and an inserted row (`w:trPr/w:del|w:ins`).
 */
import { diffKeys } from './sequence-diff.ts';
import { propertiesInner, type EmitContext } from './emit.ts';
import { compareContainer } from './story-compare.ts';
import { rowKey, unitsOf, type SideContext } from './units.ts';
import { childNamed, elementChildren, type ElementNode } from './xml-fragments.ts';

const NO_DROP: ReadonlySet<string> = new Set();
const DROP_CHANGE = (name: string): ReadonlySet<string> => new Set([name]);

/** Properties element with an optional change record of the original's properties. */
function properties(
  name: 'tblPr' | 'trPr' | 'tcPr',
  base: ElementNode | null,
  revised: ElementNode | null,
  ctx: EmitContext,
  marker = ''
): string {
  const change = `${name}Change`;
  const own = revised ?? base!;
  const side = revised ? ctx.revised : ctx.base;
  const ownProps = childNamed(own, name);
  // Row revision markers are never carried over from an input; inputs are pre-accepted.
  const drop =
    name === 'trPr'
      ? new Set([change, 'ins', 'del'])
      : name === 'tcPr'
        ? new Set([change, 'cellIns', 'cellDel', 'cellMerge'])
        : DROP_CHANGE(change);
  let inner = propertiesInner(ownProps, side, drop);
  inner += marker;
  if (base && revised && ctx.detectFormatChanges) {
    const before = propertiesInner(childNamed(base, name), ctx.base, drop);
    const after = propertiesInner(ownProps, ctx.revised, drop);
    if (normalize(before) !== normalize(after))
      inner += `<w:${change}${ctx.attrs()}><w:${name}>${before}</w:${name}></w:${change}>`;
  }
  return inner ? `<w:${name}>${inner}</w:${name}>` : '';
}

const normalize = (xml: string) => xml.replace(/\sw:rsid\w*="[^"]*"/g, '');

function gridXml(base: ElementNode | null, revised: ElementNode | null, ctx: EmitContext): string {
  const own = revised ?? base!;
  const side = revised ? ctx.revised : ctx.base;
  const grid = childNamed(own, 'tblGrid');
  let inner = propertiesInner(grid, side, DROP_CHANGE('tblGridChange'));
  if (base && revised && ctx.detectFormatChanges) {
    const before = propertiesInner(
      childNamed(base, 'tblGrid'),
      ctx.base,
      DROP_CHANGE('tblGridChange')
    );
    if (before !== inner)
      inner += `<w:tblGridChange${ctx.attrs()}><w:tblGrid>${before}</w:tblGrid></w:tblGridChange>`;
  }
  return `<w:tblGrid>${inner}</w:tblGrid>`;
}

const rowsOf = (table: ElementNode) =>
  elementChildren(table).filter((child) => child.localName === 'tr');
const cellsOf = (row: ElementNode) =>
  elementChildren(row).filter((child) => child.localName === 'tc');

export function compareTable(
  base: ElementNode | null,
  revised: ElementNode | null,
  ctx: EmitContext
): string {
  const own = revised ?? base!;
  let out = `<w:tbl>${properties('tblPr', base, revised, ctx)}${gridXml(base, revised, ctx)}`;
  const baseRows = base ? rowsOf(base) : [];
  const revisedRows = revised ? rowsOf(revised) : [];
  if (!base) for (const row of revisedRows) out += insertedRow(row, ctx);
  else if (!revised) for (const row of baseRows) out += deletedRow(row, ctx);
  else {
    let pendingBase: ElementNode[] = [];
    let pendingRevised: ElementNode[] = [];
    const flush = () => {
      // Pair rows of a change run in order while their cell counts agree.
      let k = 0;
      while (
        k < pendingBase.length &&
        k < pendingRevised.length &&
        cellsOf(pendingBase[k]!).length === cellsOf(pendingRevised[k]!).length
      ) {
        out += rowPair(pendingBase[k]!, pendingRevised[k]!, ctx);
        k++;
      }
      for (const row of pendingBase.slice(k)) out += deletedRow(row, ctx);
      for (const row of pendingRevised.slice(k)) out += insertedRow(row, ctx);
      pendingBase = [];
      pendingRevised = [];
    };
    for (const op of diffKeys(baseRows.map(rowKey), revisedRows.map(rowKey))) {
      if (op.op === 'eq') {
        flush();
        const left = baseRows[op.a]!;
        const right = revisedRows[op.b]!;
        out +=
          cellsOf(left).length === cellsOf(right).length
            ? rowPair(left, right, ctx)
            : deletedRow(left, ctx) + insertedRow(right, ctx);
      } else if (op.op === 'del') pendingBase.push(baseRows[op.a]!);
      else pendingRevised.push(revisedRows[op.b]!);
    }
    flush();
  }
  void own;
  return `${out}</w:tbl>`;
}

function rowStart(row: ElementNode, side: SideContext): string {
  const exception = childNamed(row, 'tblPrEx');
  return exception ? side.serialize(exception) : '';
}

function rowPair(base: ElementNode, revised: ElementNode, ctx: EmitContext): string {
  let out = `<w:tr>${rowStart(revised, ctx.revised)}${properties('trPr', base, revised, ctx)}`;
  const baseCells = cellsOf(base);
  const revisedCells = cellsOf(revised);
  revisedCells.forEach((cell, index) => {
    const original = baseCells[index]!;
    out += `<w:tc>${properties('tcPr', original, cell, ctx)}${compareContainer(unitsOf(original, ctx.base), unitsOf(cell, ctx.revised), ctx)}</w:tc>`;
  });
  return `${out}</w:tr>`;
}

function deletedRow(row: ElementNode, ctx: EmitContext): string {
  let out = `<w:tr>${rowStart(row, ctx.base)}${properties('trPr', row, null, ctx, `<w:del${ctx.attrs()}/>`)}`;
  for (const cell of cellsOf(row)) {
    out += `<w:tc>${properties('tcPr', cell, null, ctx)}${compareContainer(unitsOf(cell, ctx.base), [], ctx)}</w:tc>`;
  }
  return `${out}</w:tr>`;
}

function insertedRow(row: ElementNode, ctx: EmitContext): string {
  let out = `<w:tr>${rowStart(row, ctx.revised)}${properties('trPr', null, row, ctx, `<w:ins${ctx.attrs()}/>`)}`;
  for (const cell of cellsOf(row)) {
    out += `<w:tc>${properties('tcPr', null, cell, ctx)}${compareContainer([], unitsOf(cell, ctx.revised), ctx)}</w:tc>`;
  }
  return `${out}</w:tr>`;
}

/** A block content control: the revised shell around compared content. */
export function compareSdt(
  base: ElementNode | null,
  revised: ElementNode | null,
  ctx: EmitContext
): string {
  const own = revised ?? base!;
  const side = revised ? ctx.revised : ctx.base;
  const shell = elementChildren(own)
    .filter((child) => child.localName === 'sdtPr' || child.localName === 'sdtEndPr')
    .map((child) => side.serialize(child))
    .join('');
  const content = (node: ElementNode | null, sideOf: SideContext) => {
    const holder = node ? childNamed(node, 'sdtContent') : undefined;
    return holder ? unitsOf(holder, sideOf) : [];
  };
  const body = compareContainer(content(base, ctx.base), content(revised, ctx.revised), ctx);
  void NO_DROP;
  return `<w:sdt>${shell}<w:sdtContent>${body}</w:sdtContent></w:sdt>`;
}

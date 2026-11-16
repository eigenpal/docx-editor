/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
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

const DROP_CHANGE = (name: string): ReadonlySet<string> => new Set([name]);

/**
 * Properties element with an optional change record of the original's properties. `bundled`
 * records the original's properties even when they are equal: a reject restores the formatting
 * of a row, and of a table with alignment or grid history, as one decision, and resets every
 * cell of such a row that carries no record.
 */
function properties(
  name: 'tblPr' | 'trPr' | 'tcPr',
  base: ElementNode | null,
  revised: ElementNode | null,
  ctx: EmitContext,
  marker = '',
  bundled = false
): string {
  const change = `${name}Change`;
  const own = revised ?? base!;
  const side = revised ? ctx.revised : ctx.base;
  let inner = propertiesInner(childNamed(own, name), side, DROPS[name]);
  inner += marker;
  if (
    base &&
    revised &&
    ctx.detectFormatChanges &&
    (bundled || propertiesDiffer(name, base, revised, ctx))
  ) {
    const before = propertiesInner(childNamed(base, name), ctx.base, DROPS[name]);
    inner += `<w:${change}${ctx.attrs()}><w:${name}>${before}</w:${name}></w:${change}>`;
  }
  if (inner) return `<w:${name}>${inner}</w:${name}>`;
  // A table must have its properties element: without it, a table reads with legacy defaults
  // (other cell margins and an automatic width).
  return name === 'tblPr' ? '<w:tblPr/>' : '';
}

type PropertiesName = 'tblPr' | 'trPr' | 'tcPr' | 'tblPrEx';

/** Children never carried over from an input: change records and pre-accepted markers. */
const DROPS: Readonly<Record<PropertiesName, ReadonlySet<string>>> = {
  tblPr: DROP_CHANGE('tblPrChange'),
  trPr: new Set(['trPrChange', 'ins', 'del']),
  tcPr: new Set(['tcPrChange', 'cellIns', 'cellDel', 'cellMerge']),
  tblPrEx: DROP_CHANGE('tblPrExChange'),
};

function propertiesDiffer(
  name: PropertiesName,
  base: ElementNode,
  revised: ElementNode,
  ctx: EmitContext
): boolean {
  const before = propertiesInner(childNamed(base, name), ctx.base, DROPS[name]);
  const after = propertiesInner(childNamed(revised, name), ctx.revised, DROPS[name]);
  return normalize(before) !== normalize(after);
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
      inner += `<w:tblGridChange${ctx.idOnly()}><w:tblGrid>${before}</w:tblGrid></w:tblGridChange>`;
  }
  return `<w:tblGrid>${inner}</w:tblGrid>`;
}

const rowsOf = (table: ElementNode) =>
  elementChildren(table).filter((child) => child.localName === 'tr');
const cellsOf = (row: ElementNode) =>
  elementChildren(row).filter((child) => child.localName === 'tc');

/**
 * Other children of a table (around its rows) or a row (around its cells): bookmarks, comment
 * and permission ranges, and content controls or custom XML around rows and cells. Each sits
 * before the row or cell with index `at`.
 */
interface Extra {
  readonly at: number;
  readonly xml: string;
}

const TABLE_OWN = new Set(['tblPr', 'tblGrid', 'tr']);
const ROW_OWN = new Set(['tblPrEx', 'trPr', 'tc']);

function extrasOf(
  node: ElementNode | null,
  own: ReadonlySet<string>,
  item: string,
  side: SideContext
): Extra[] {
  const out: Extra[] = [];
  let at = 0;
  for (const child of node ? elementChildren(node) : []) {
    if (child.localName === item) at++;
    else if (!own.has(child.localName)) out.push({ at, xml: side.serialize(child) });
  }
  return out;
}

const sameExtras = (a: readonly Extra[], b: readonly Extra[]) =>
  a.length === b.length &&
  a.every((extra, i) => extra.at === b[i]!.at && normalize(extra.xml) === normalize(b[i]!.xml));

/**
 * The extras an output table or row carries. They have no revision form, so they are kept only
 * when a reject and an accept both keep them: the same in both documents, or in a deleted
 * table or row (from the original). Inserted ones, or ones that differ, refuse the compare.
 */
function carriedExtras(
  base: ElementNode | null,
  revised: ElementNode | null,
  own: ReadonlySet<string>,
  item: string,
  ctx: EmitContext
): Extra[] {
  const before = extrasOf(base, own, item, ctx.base);
  if (!revised) return before;
  const after = extrasOf(revised, own, item, ctx.revised);
  if (after.length > 0 && (!base || !sameExtras(before, after))) ctx.state.untracked++;
  else if (before.length > 0 && !sameExtras(before, after)) ctx.state.untracked++;
  return base ? before : [];
}

/**
 * The extras by the item they sit before, in their order: one pass over the extras, not one
 * scan of them for every item.
 */
function positioned(extras: readonly Extra[]): (at: number) => string {
  const byItem = new Map<number, string>();
  for (const extra of extras) byItem.set(extra.at, (byItem.get(extra.at) ?? '') + extra.xml);
  return (at) => byItem.get(at) ?? '';
}

export function compareTable(
  base: ElementNode | null,
  revised: ElementNode | null,
  ctx: EmitContext
): string {
  const own = revised ?? base!;
  const grid = gridXml(base, revised, ctx);
  let out = `<w:tbl>${properties('tblPr', base, revised, ctx)}${grid}`;
  // Alignment or grid history binds to the table's cell history only when cells record one.
  const tableBundle =
    !!base &&
    !!revised &&
    (propertiesDiffer('tblPr', base, revised, ctx) || grid.includes('<w:tblGridChange'));
  const baseRows = base ? rowsOf(base) : [];
  const revisedRows = revised ? rowsOf(revised) : [];
  const extras = carriedExtras(base, revised, TABLE_OWN, 'tr', ctx);
  // An extra sits before the rows that follow it in both documents: it is written where as many
  // original rows and as many revised rows precede it as in each input, so both an accept and
  // a reject keep it in place. With no such place, it cannot be kept.
  let baseCount = 0;
  let revisedCount = 0;
  let next = 0;
  const place = () => {
    while (next < extras.length) {
      const at = extras[next]!.at;
      const baseAt = !base || baseCount === at;
      const revisedAt = !revised || revisedCount === at;
      if (!baseAt || !revisedAt) {
        // Past its place on either side: no output position keeps it in both.
        if ((base && baseCount > at) || (revised && revisedCount > at)) {
          ctx.state.untracked++;
          next++;
          continue;
        }
        return;
      }
      out += extras[next]!.xml;
      next++;
    }
  };
  const emit = (row: string, fromBase: boolean, fromRevised: boolean) => {
    place();
    out += row;
    if (fromBase) baseCount++;
    if (fromRevised) revisedCount++;
  };
  if (!base) for (const row of revisedRows) emit(insertedRow(row, ctx), false, true);
  else if (!revised)
    for (const row of baseRows) emit(deletedRow(row, ctx, tableBundle), true, false);
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
        emit(rowPair(pendingBase[k]!, pendingRevised[k]!, ctx, tableBundle), true, true);
        k++;
      }
      for (const row of pendingBase.slice(k)) emit(deletedRow(row, ctx, tableBundle), true, false);
      for (const row of pendingRevised.slice(k)) emit(insertedRow(row, ctx), false, true);
      pendingBase = [];
      pendingRevised = [];
    };
    for (const op of diffKeys(baseRows.map(rowKey), revisedRows.map(rowKey))) {
      if (op.op === 'eq') {
        flush();
        const left = baseRows[op.a]!;
        const right = revisedRows[op.b]!;
        if (cellsOf(left).length === cellsOf(right).length)
          emit(rowPair(left, right, ctx, tableBundle), true, true);
        else {
          emit(deletedRow(left, ctx, tableBundle), true, false);
          emit(insertedRow(right, ctx), false, true);
        }
      } else if (op.op === 'del') pendingBase.push(baseRows[op.a]!);
      else pendingRevised.push(revisedRows[op.b]!);
    }
    flush();
  }
  place();
  if (next < extras.length) ctx.state.untracked++;
  void own;
  return `${out}</w:tbl>`;
}

function rowStart(row: ElementNode, side: SideContext): string {
  const exception = childNamed(row, 'tblPrEx');
  return exception ? side.serialize(exception) : '';
}

/** Row-level table property exceptions of a matched row, with a record when they differ. */
function rowException(base: ElementNode, revised: ElementNode, ctx: EmitContext): string {
  const own = childNamed(revised, 'tblPrEx');
  const old = childNamed(base, 'tblPrEx');
  if (!ctx.detectFormatChanges || !propertiesDiffer('tblPrEx', base, revised, ctx))
    return rowStart(revised, ctx.revised);
  // An exception only the revised row has: a reject may keep every field a record does not
  // name, and an exception field has no value that means "as the table states".
  if (!old) {
    ctx.state.unrecordedProperties++;
    return rowStart(revised, ctx.revised);
  }
  // An exception only the original row has: an empty exception records it, which a reject
  // restores in full because the record names every field it had.
  const before = propertiesInner(old, ctx.base, DROPS.tblPrEx);
  const after = own ? propertiesInner(own, ctx.revised, DROPS.tblPrEx) : '';
  return `<w:tblPrEx>${after}<w:tblPrExChange${ctx.attrs()}><w:tblPrEx>${before}</w:tblPrEx></w:tblPrExChange></w:tblPrEx>`;
}

function rowPair(
  base: ElementNode,
  revised: ElementNode,
  ctx: EmitContext,
  tableBundle: boolean
): string {
  const baseCells = cellsOf(base);
  const revisedCells = cellsOf(revised);
  // Any formatting record in the row makes a reject restore every cell of it.
  const bundled =
    tableBundle ||
    propertiesDiffer('trPr', base, revised, ctx) ||
    propertiesDiffer('tblPrEx', base, revised, ctx) ||
    revisedCells.some((cell, index) => propertiesDiffer('tcPr', baseCells[index]!, cell, ctx));
  const extrasAt = positioned(carriedExtras(base, revised, ROW_OWN, 'tc', ctx));
  let out = `<w:tr>${rowException(base, revised, ctx)}${properties('trPr', base, revised, ctx)}`;
  revisedCells.forEach((cell, index) => {
    const original = baseCells[index]!;
    out += `${extrasAt(index)}<w:tc>${properties('tcPr', original, cell, ctx, '', bundled)}${compareContainer(unitsOf(original, ctx.base), unitsOf(cell, ctx.revised), ctx)}</w:tc>`;
  });
  return `${out}${extrasAt(revisedCells.length)}</w:tr>`;
}

/**
 * A row only the original has. With table history (`tableBundle`), each cell records its own
 * formatting unchanged, because a reject restores table history only through cell records.
 */
function deletedRow(row: ElementNode, ctx: EmitContext, tableBundle: boolean): string {
  const extrasAt = positioned(carriedExtras(row, null, ROW_OWN, 'tc', ctx));
  const cellProperties = (cell: ElementNode) => {
    if (!tableBundle || !ctx.detectFormatChanges) return properties('tcPr', cell, null, ctx);
    const inner = propertiesInner(childNamed(cell, 'tcPr'), ctx.base, DROPS.tcPr);
    return `<w:tcPr>${inner}<w:tcPrChange${ctx.attrs()}><w:tcPr>${inner}</w:tcPr></w:tcPrChange></w:tcPr>`;
  };
  let out = `<w:tr>${rowStart(row, ctx.base)}${properties('trPr', row, null, ctx, `<w:del${ctx.attrs()}/>`)}`;
  const cells = cellsOf(row);
  for (const [index, cell] of cells.entries()) {
    out += `${extrasAt(index)}<w:tc>${cellProperties(cell)}${compareContainer(unitsOf(cell, ctx.base), [], ctx)}</w:tc>`;
  }
  return `${out}${extrasAt(cells.length)}</w:tr>`;
}

function insertedRow(row: ElementNode, ctx: EmitContext): string {
  carriedExtras(null, row, ROW_OWN, 'tc', ctx);
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
  const shellOf = (node: ElementNode, sideOf: SideContext) =>
    elementChildren(node)
      .filter((child) => child.localName === 'sdtPr' || child.localName === 'sdtEndPr')
      .map((child) => sideOf.serialize(child))
      .join('');
  // A control's properties have no revision form: the result takes the revised control's
  // properties. A control only one document has keeps its shell on the other side; when all of
  // its content is accepted or rejected away, the store leaves an empty placeholder control.
  const shell = shellOf(own, side);
  const content = (node: ElementNode | null, sideOf: SideContext) => {
    const holder = node ? childNamed(node, 'sdtContent') : undefined;
    return holder ? unitsOf(holder, sideOf) : [];
  };
  const body = compareContainer(content(base, ctx.base), content(revised, ctx.revised), ctx);
  return `<w:sdt>${shell}<w:sdtContent>${body}</w:sdtContent></w:sdt>`;
}

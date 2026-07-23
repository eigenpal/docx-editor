// WordprocessingML element -> authored-model parsers (document-engine task 2.10).
// Reads the bounded, order-preserving XML tree into authored records: runs (through
// run wrappers), paragraphs, tables (structural, with prop parsers), styles, numbering,
// and related stories; plus the block-span fragment builders and the tree-shape guards
// (table detection/counting, non-w namespace binding) the OPC orchestrator uses to fail
// closed. Treats all values as untrusted; no serialization or preservation logic here.

import { strFromU8 } from './zip.ts';
import { readXml, findElement, childElements, textContent, type XmlNode } from './xml-reader.ts';
import { resolveInternalTarget } from './opc-names.ts';
import { type BlockSpan } from './wml-scan.ts';
import { IdentityAllocator } from '../model/identity.ts';
import {
  type Block,
  type ParagraphRecord,
  type RunRecord,
  type RunProps,
  type StyleRecord,
  type NumberingRecord,
  type TableRecord,
  type TableRowRecord,
  type TableCellRecord,
  type TableProps,
  type TableRowProps,
  type TableCellProps,
  type TableWidth,
  type Borders,
  type BorderEdge,
  type Shading,
  type CellMargins,
  type GridColumn,
  type VMerge,
} from '../model/index.ts';

/** Parse a bounded integer attribute; NaN/Infinity/non-integers become undefined so
 *  untrusted values never enter the model or throw during hashing (the verbatim range
 *  still holds the real lexical value). */
function intAttr(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isInteger(n) ? n : undefined;
}

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export function el(node: XmlNode): node is Extract<XmlNode, { type: 'element' }> {
  return node.type === 'element';
}

// Run-wrapping elements whose child w:r must still be collected (OOXML review).
// w:fldSimple wraps a simple field's RESULT runs (ECMA-376 Part 1 §17.16.19); its
// w:instr instruction attribute stays inert (not a run), but the result w:r text
// is the displayed content and must be collected (e.g. "Page X of Y").
const RUN_WRAPPERS = new Set(['w:hyperlink', 'w:ins', 'w:del', 'w:smartTag', 'w:sdt', 'w:sdtContent', 'w:fldSimple']);

/** Collect every w:r element under a node, recursing through run wrappers. */
function collectRunElements(node: Extract<XmlNode, { type: 'element' }>): Extract<XmlNode, { type: 'element' }>[] {
  const runs: Extract<XmlNode, { type: 'element' }>[] = [];
  for (const child of node.children) {
    if (!el(child)) continue;
    if (child.name === 'w:r') runs.push(child);
    else if (RUN_WRAPPERS.has(child.name)) runs.push(...collectRunElements(child));
  }
  return runs;
}

/**
 * Parse a run element into an authored run. Reads ALL w:t segments in order and
 * maps w:tab/w:br/w:cr/w:noBreakHyphen to their characters (so a break-only run
 * is not dropped). Reads w:rPr bold/italic.
 */
function parseRun(run: Extract<XmlNode, { type: 'element' }>): RunRecord | undefined {
  let text = '';
  for (const child of run.children) {
    if (!el(child)) continue;
    switch (child.name) {
      case 'w:t':
        text += textContent(child);
        break;
      case 'w:tab':
        text += '\t';
        break;
      case 'w:br':
      case 'w:cr':
        text += '\n';
        break;
      case 'w:noBreakHyphen':
        text += '‑';
        break;
    }
  }
  const rPr = childElements(run, 'w:rPr')[0];
  const props: RunProps = {};
  if (rPr) {
    if (childElements(rPr, 'w:b').length > 0) (props as { bold?: boolean }).bold = true;
    if (childElements(rPr, 'w:i').length > 0) (props as { italic?: boolean }).italic = true;
  }
  if (text.length === 0 && Object.keys(props).length === 0) return undefined;
  return Object.keys(props).length > 0 ? { text, props } : { text };
}

/**
 * Collect every paragraph (w:p) under a container, recovering text from tables
 * (w:tbl › w:tr › w:tc) and block SDT (w:sdt › w:sdtContent) by flattening their
 * cell/content paragraphs. Used for related stories (header/footer/notes) and for
 * table-free body documents. NOTE (scope): related-story tables are still FLATTENED
 * here — structural tables in headers/footers/notes, and full related-part export,
 * are the next slice (body-level document.xml tables are the current one).
 */
export function collectParagraphElements(container: Extract<XmlNode, { type: 'element' }>): Extract<XmlNode, { type: 'element' }>[] {
  const paras: Extract<XmlNode, { type: 'element' }>[] = [];
  for (const child of container.children) {
    if (!el(child)) continue;
    if (child.name === 'w:p') paras.push(child);
    else if (child.name === 'w:tbl') {
      for (const row of childElements(child, 'w:tr')) {
        for (const cell of childElements(row, 'w:tc')) paras.push(...collectParagraphElements(cell));
      }
    } else if (child.name === 'w:sdt') {
      const content = childElements(child, 'w:sdtContent')[0];
      if (content) paras.push(...collectParagraphElements(content));
    } else if (child.name === 'w:customXml') {
      paras.push(...collectParagraphElements(child)); // transparent block wrapper
    }
  }
  return paras;
}

/** Collect every `Relationship` element from a rels part's tree. */
function allRelationships(nodes: readonly XmlNode[]): Extract<XmlNode, { type: 'element' }>[] {
  const out: Extract<XmlNode, { type: 'element' }>[] = [];
  const walk = (ns: readonly XmlNode[]): void => {
    for (const n of ns) {
      if (!el(n)) continue;
      if (n.name === 'Relationship') out.push(n);
      else walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

// Related-story parts: rel-type suffix -> { model story kind, part root element,
// and (for note/comment collections) the per-item wrapper element }.
interface StorySpec {
  readonly kind: 'header' | 'footer' | 'footnote' | 'endnote' | 'comment';
  readonly root: string;
  readonly item?: string;
}
const STORY_SPECS: Record<string, StorySpec> = {
  '/header': { kind: 'header', root: 'w:hdr' },
  '/footer': { kind: 'footer', root: 'w:ftr' },
  '/footnotes': { kind: 'footnote', root: 'w:footnotes', item: 'w:footnote' },
  '/endnotes': { kind: 'endnote', root: 'w:endnotes', item: 'w:endnote' },
  '/comments': { kind: 'comment', root: 'w:comments', item: 'w:comment' },
};

/** Related-story parts referenced by document.xml's relationships (internal only). */
export function relatedStoryParts(entries: ReadonlyMap<string, Uint8Array>): { partName: string; spec: StorySpec }[] {
  const relsPart = entries.get('/word/_rels/document.xml.rels');
  if (!relsPart) return [];
  const rx = readXml(strFromU8(relsPart));
  if (!rx.ok) return [];
  const out: { partName: string; spec: StorySpec }[] = [];
  for (const rel of allRelationships(rx.nodes)) {
    if (rel.attributes.TargetMode === 'External') continue;
    const type = rel.attributes.Type ?? '';
    const suffix = Object.keys(STORY_SPECS).find((s) => type.endsWith(s));
    if (!suffix) continue;
    const resolved = resolveInternalTarget('/word/document.xml', rel.attributes.Target ?? '');
    if (resolved.ok) out.push({ partName: resolved.partName, spec: STORY_SPECS[suffix] });
  }
  return out;
}

export function parseStoryParagraphs(root: Extract<XmlNode, { type: 'element' }>, alloc: IdentityAllocator): ParagraphRecord[] {
  return collectParagraphElements(root).map((p) => {
    const runs: RunRecord[] = [];
    for (const runEl of collectRunElements(p)) {
      const run = parseRun(runEl);
      if (run) runs.push(run);
    }
    return { kind: 'paragraph', id: alloc.allocate('paragraph'), runs };
  });
}

/** Parse word/styles.xml into authored style records (task 2.7). */
export function parseStyles(entries: ReadonlyMap<string, Uint8Array>): StyleRecord[] {
  const part = entries.get('/word/styles.xml');
  if (!part) return [];
  const sx = readXml(strFromU8(part));
  if (!sx.ok) return [];
  const root = findElement(sx.nodes, 'w:styles');
  if (!root) return [];
  const out: StyleRecord[] = [];
  for (const style of childElements(root, 'w:style') as Extract<XmlNode, { type: 'element' }>[]) {
    const id = style.attributes['w:styleId'];
    if (!id) continue;
    const t = style.attributes['w:type'];
    const type: StyleRecord['type'] = t === 'character' || t === 'table' || t === 'numbering' ? t : 'paragraph';
    const name = childElements(style, 'w:name')[0]?.attributes['w:val'] ?? id;
    const isDefault = style.attributes['w:default'] === '1' || style.attributes['w:default'] === 'true';
    out.push(isDefault ? { id, name, type, isDefault: true } : { id, name, type });
  }
  return out;
}

/** Parse word/numbering.xml into authored numbering records (task 2.7). */
export function parseNumbering(entries: ReadonlyMap<string, Uint8Array>): NumberingRecord[] {
  const part = entries.get('/word/numbering.xml');
  if (!part) return [];
  const sx = readXml(strFromU8(part));
  if (!sx.ok) return [];
  const root = findElement(sx.nodes, 'w:numbering');
  if (!root) return [];
  const out: NumberingRecord[] = [];
  for (const num of childElements(root, 'w:num') as Extract<XmlNode, { type: 'element' }>[]) {
    const numId = num.attributes['w:numId'];
    if (!numId) continue;
    const abstractId = childElements(num, 'w:abstractNumId')[0]?.attributes['w:val'] ?? '';
    out.push({ numId, abstractId });
  }
  return out;
}

// ---- structural table parsing (the layout/render projection; losslessness on
// save comes from the verbatim range, so this need not model every property) ----

function attr(el: Extract<XmlNode, { type: 'element' }>, name: string): string | undefined {
  return el.attributes[name];
}

function parseWidth(el: Extract<XmlNode, { type: 'element' }> | undefined): TableWidth | undefined {
  if (!el) return undefined;
  const value = attr(el, 'w:w');
  const type = attr(el, 'w:type');
  if (value === undefined && type === undefined) return undefined;
  return { ...(type !== undefined ? { type } : {}), ...(value !== undefined ? { value } : {}) };
}

const BORDER_EDGES: ReadonlyArray<[keyof Borders, string]> = [
  ['top', 'w:top'], ['bottom', 'w:bottom'], ['left', 'w:left'], ['right', 'w:right'],
  ['start', 'w:start'], ['end', 'w:end'], ['insideH', 'w:insideH'], ['insideV', 'w:insideV'],
  ['tl2br', 'w:tl2br'], ['tr2bl', 'w:tr2bl'],
];

function parseBorders(el: Extract<XmlNode, { type: 'element' }> | undefined): Borders | undefined {
  if (!el) return undefined;
  const out: Record<string, BorderEdge> = {};
  for (const [key, tag] of BORDER_EDGES) {
    const e = childElements(el, tag)[0];
    if (!e) continue;
    const edge: BorderEdge = {
      ...(attr(e, 'w:val') !== undefined ? { style: attr(e, 'w:val') } : {}),
      ...(attr(e, 'w:sz') !== undefined ? { sz: attr(e, 'w:sz') } : {}),
      ...(attr(e, 'w:space') !== undefined ? { space: attr(e, 'w:space') } : {}),
      ...(attr(e, 'w:color') !== undefined ? { color: attr(e, 'w:color') } : {}),
      ...(attr(e, 'w:themeColor') !== undefined ? { themeColor: attr(e, 'w:themeColor') } : {}),
    };
    out[key] = edge;
  }
  return Object.keys(out).length > 0 ? (out as Borders) : undefined;
}

function parseShd(el: Extract<XmlNode, { type: 'element' }> | undefined): Shading | undefined {
  const shd = el ? childElements(el, 'w:shd')[0] : undefined;
  if (!shd) return undefined;
  const out: Shading = {
    ...(attr(shd, 'w:val') !== undefined ? { val: attr(shd, 'w:val') } : {}),
    ...(attr(shd, 'w:fill') !== undefined ? { fill: attr(shd, 'w:fill') } : {}),
    ...(attr(shd, 'w:color') !== undefined ? { color: attr(shd, 'w:color') } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseMargins(el: Extract<XmlNode, { type: 'element' }> | undefined): CellMargins | undefined {
  if (!el) return undefined;
  const sides: ReadonlyArray<[keyof CellMargins, string]> = [
    ['top', 'w:top'], ['bottom', 'w:bottom'], ['left', 'w:left'], ['right', 'w:right'], ['start', 'w:start'], ['end', 'w:end'],
  ];
  const out: Record<string, TableWidth> = {};
  for (const [key, tag] of sides) {
    const w = parseWidth(childElements(el, tag)[0]);
    if (w) out[key] = w;
  }
  return Object.keys(out).length > 0 ? (out as CellMargins) : undefined;
}

function parseTableProps(tblPr: Extract<XmlNode, { type: 'element' }> | undefined): TableProps | undefined {
  if (!tblPr) return undefined;
  const width = parseWidth(childElements(tblPr, 'w:tblW')[0]);
  const layoutEl = childElements(tblPr, 'w:tblLayout')[0];
  const props: TableProps = {
    ...(childElements(tblPr, 'w:tblStyle')[0]?.attributes['w:val'] !== undefined ? { styleId: childElements(tblPr, 'w:tblStyle')[0].attributes['w:val'] } : {}),
    ...(width ? { width } : {}),
    ...(childElements(tblPr, 'w:jc')[0]?.attributes['w:val'] !== undefined ? { alignment: childElements(tblPr, 'w:jc')[0].attributes['w:val'] } : {}),
    ...(parseWidth(childElements(tblPr, 'w:tblInd')[0]) ? { indent: parseWidth(childElements(tblPr, 'w:tblInd')[0])! } : {}),
    ...(layoutEl?.attributes['w:type'] !== undefined ? { layout: layoutEl.attributes['w:type'] } : {}),
    ...(parseWidth(childElements(tblPr, 'w:tblCellSpacing')[0]) ? { cellSpacing: parseWidth(childElements(tblPr, 'w:tblCellSpacing')[0])! } : {}),
    ...(parseMargins(childElements(tblPr, 'w:tblCellMar')[0]) ? { cellMargins: parseMargins(childElements(tblPr, 'w:tblCellMar')[0])! } : {}),
    ...(parseBorders(childElements(tblPr, 'w:tblBorders')[0]) ? { borders: parseBorders(childElements(tblPr, 'w:tblBorders')[0])! } : {}),
    ...(parseShd(tblPr) ? { shading: parseShd(tblPr)! } : {}),
    ...(childElements(tblPr, 'w:tblLook')[0]?.attributes['w:val'] !== undefined ? { look: childElements(tblPr, 'w:tblLook')[0].attributes['w:val'] } : {}),
    ...(childElements(tblPr, 'w:bidiVisual').length > 0 ? { bidiVisual: true } : {}),
  };
  return Object.keys(props).length > 0 ? props : undefined;
}

function parseRowProps(trPr: Extract<XmlNode, { type: 'element' }> | undefined): TableRowProps | undefined {
  if (!trPr) return undefined;
  const h = childElements(trPr, 'w:trHeight')[0];
  const gb = intAttr(childElements(trPr, 'w:gridBefore')[0]?.attributes['w:val']);
  const ga = intAttr(childElements(trPr, 'w:gridAfter')[0]?.attributes['w:val']);
  const props: TableRowProps = {
    ...(childElements(trPr, 'w:tblHeader').length > 0 ? { isHeader: true } : {}),
    ...(childElements(trPr, 'w:cantSplit').length > 0 ? { cantSplit: true } : {}),
    ...(h?.attributes['w:val'] !== undefined ? { height: h.attributes['w:val'] } : {}),
    ...(h?.attributes['w:hRule'] !== undefined ? { heightRule: h.attributes['w:hRule'] } : {}),
    ...(gb !== undefined ? { gridBefore: gb } : {}),
    ...(ga !== undefined ? { gridAfter: ga } : {}),
    ...(parseWidth(childElements(trPr, 'w:wBefore')[0]) ? { widthBefore: parseWidth(childElements(trPr, 'w:wBefore')[0])! } : {}),
    ...(parseWidth(childElements(trPr, 'w:wAfter')[0]) ? { widthAfter: parseWidth(childElements(trPr, 'w:wAfter')[0])! } : {}),
  };
  return Object.keys(props).length > 0 ? props : undefined;
}

function parseCellProps(tcPr: Extract<XmlNode, { type: 'element' }> | undefined): TableCellProps | undefined {
  if (!tcPr) return undefined;
  const gridSpan = intAttr(childElements(tcPr, 'w:gridSpan')[0]?.attributes['w:val']);
  const vMergeEl = childElements(tcPr, 'w:vMerge')[0];
  const vMerge: VMerge | undefined = vMergeEl ? (vMergeEl.attributes['w:val'] !== undefined ? { val: vMergeEl.attributes['w:val'] } : {}) : undefined;
  const props: TableCellProps = {
    ...(parseWidth(childElements(tcPr, 'w:tcW')[0]) ? { width: parseWidth(childElements(tcPr, 'w:tcW')[0])! } : {}),
    ...(gridSpan !== undefined ? { gridSpan } : {}),
    ...(vMerge !== undefined ? { vMerge } : {}),
    ...(parseBorders(childElements(tcPr, 'w:tcBorders')[0]) ? { borders: parseBorders(childElements(tcPr, 'w:tcBorders')[0])! } : {}),
    ...(parseShd(tcPr) ? { shading: parseShd(tcPr)! } : {}),
    ...(childElements(tcPr, 'w:vAlign')[0]?.attributes['w:val'] !== undefined ? { vAlign: childElements(tcPr, 'w:vAlign')[0].attributes['w:val'] } : {}),
    ...(parseMargins(childElements(tcPr, 'w:tcMar')[0]) ? { margins: parseMargins(childElements(tcPr, 'w:tcMar')[0])! } : {}),
    ...(childElements(tcPr, 'w:noWrap').length > 0 ? { noWrap: true } : {}),
    ...(childElements(tcPr, 'w:textDirection')[0]?.attributes['w:val'] !== undefined ? { textDirection: childElements(tcPr, 'w:textDirection')[0].attributes['w:val'] } : {}),
  };
  return Object.keys(props).length > 0 ? props : undefined;
}

export function paragraphFromElement(pEl: Extract<XmlNode, { type: 'element' }>, alloc: IdentityAllocator): ParagraphRecord {
  const runs: RunRecord[] = [];
  for (const runEl of collectRunElements(pEl)) {
    const run = parseRun(runEl);
    if (run) runs.push(run);
  }
  return { kind: 'paragraph', id: alloc.allocate('paragraph'), runs };
}

/** Block children of a cell (w:p / nested w:tbl), descending block wrappers so
 *  wrapper-wrapped cell content is still projected (not just direct children). */
function cellBlocks(tc: Extract<XmlNode, { type: 'element' }>, alloc: IdentityAllocator): Block[] {
  const blocks: Block[] = [];
  for (const child of tc.children) {
    if (!el(child)) continue;
    if (child.name === 'w:p') blocks.push(paragraphFromElement(child, alloc));
    else if (child.name === 'w:tbl') blocks.push(parseTable(child, alloc));
    else if (child.name === 'w:sdt') {
      const content = childElements(child, 'w:sdtContent')[0];
      if (content) blocks.push(...cellBlocks(content, alloc));
    } else if (child.name === 'w:customXml') blocks.push(...cellBlocks(child, alloc));
  }
  return blocks;
}

/** Rows of a table, descending block wrappers (w:sdt/w:customXml) that may wrap w:tr. */
function collectRows(container: Extract<XmlNode, { type: 'element' }>): Extract<XmlNode, { type: 'element' }>[] {
  const rows: Extract<XmlNode, { type: 'element' }>[] = [];
  for (const child of container.children) {
    if (!el(child)) continue;
    if (child.name === 'w:tr') rows.push(child);
    else if (child.name === 'w:sdt') {
      const content = childElements(child, 'w:sdtContent')[0];
      if (content) rows.push(...collectRows(content));
    } else if (child.name === 'w:customXml') rows.push(...collectRows(child));
  }
  return rows;
}

/** Cells of a row, descending block wrappers (w:sdt/w:customXml) that may wrap w:tc. */
function collectCells(row: Extract<XmlNode, { type: 'element' }>): Extract<XmlNode, { type: 'element' }>[] {
  const cells: Extract<XmlNode, { type: 'element' }>[] = [];
  for (const child of row.children) {
    if (!el(child)) continue;
    if (child.name === 'w:tc') cells.push(child);
    else if (child.name === 'w:sdt') {
      const content = childElements(child, 'w:sdtContent')[0];
      if (content) cells.push(...collectCells(content));
    } else if (child.name === 'w:customXml') cells.push(...collectCells(child));
  }
  return cells;
}

function parseTable(tbl: Extract<XmlNode, { type: 'element' }>, alloc: IdentityAllocator): TableRecord {
  const tblPr = childElements(tbl, 'w:tblPr')[0];
  const gridEl = childElements(tbl, 'w:tblGrid')[0];
  const grid: GridColumn[] = gridEl
    ? childElements(gridEl, 'w:gridCol').map((c) => (c.attributes['w:w'] !== undefined ? { w: c.attributes['w:w'] } : {}))
    : [];
  const rows: TableRowRecord[] = collectRows(tbl).map((tr) => {
    const trPr = childElements(tr, 'w:trPr')[0];
    const cells: TableCellRecord[] = collectCells(tr).map((tc) => {
      const tcPr = childElements(tc, 'w:tcPr')[0];
      const props = parseCellProps(tcPr);
      return { id: alloc.allocate('cell'), blocks: cellBlocks(tc, alloc), ...(props ? { props } : {}) };
    });
    const props = parseRowProps(trPr);
    return { id: alloc.allocate('row'), cells, ...(props ? { props } : {}) };
  });
  const props = parseTableProps(tblPr);
  return {
    kind: 'table',
    id: alloc.allocate('table'),
    rows,
    ...(grid.length > 0 ? { grid } : {}),
    ...(props ? { props } : {}),
  };
}

/** Build a block from a source substring (a w:p / w:tbl fragment). Returns undefined
 *  for a parse failure or an unexpected root, so callers can fail closed. */
export function blockFromText(text: string, alloc: IdentityAllocator): Block | undefined {
  const fx = readXml(text);
  if (!fx.ok) return undefined;
  const rootEl = fx.nodes.find(el);
  if (!rootEl) return undefined;
  if (rootEl.name === 'w:tbl') return parseTable(rootEl, alloc);
  if (rootEl.name === 'w:p') return paragraphFromElement(rootEl, alloc);
  return undefined;
}

export function blockFromSpan(docText: string, span: BlockSpan, alloc: IdentityAllocator): Block | undefined {
  return blockFromText(docText.slice(span.start, span.end), alloc);
}

/** Whether the parsed body tree contains a table at top level (descending into
 *  block-level w:sdt). Used so a malformed TABLE document is rejected rather than
 *  silently falling back to a flat, lossy parse. */
export function treeHasTable(container: Extract<XmlNode, { type: 'element' }>): boolean {
  for (const child of container.children) {
    if (!el(child)) continue;
    if (child.name === 'w:tbl') return true;
    if (child.name === 'w:sdt') {
      const content = childElements(child, 'w:sdtContent')[0];
      if (content && treeHasTable(content)) return true;
    }
    if (child.name === 'w:customXml' && treeHasTable(child)) return true;
  }
  return false;
}

/** Whether a table appears ANYWHERE in the subtree (any wrapper, any depth). */
export function deepHasTable(container: Extract<XmlNode, { type: 'element' }>): boolean {
  return deepCountTables(container) > 0;
}

/** Count every `w:tbl` element anywhere in the subtree (including nested tables). */
export function deepCountTables(container: Extract<XmlNode, { type: 'element' }>): number {
  let n = 0;
  for (const child of container.children) {
    if (!el(child)) continue;
    if (child.name === 'w:tbl') n += 1;
    n += deepCountTables(child);
  }
  return n;
}

/** Count every table projected into the model (top-level and nested in cells). Every
 *  source `w:tbl` must become a TableRecord, or a table is hidden and we fail closed. */
export function countModelTables(blocks: readonly Block[]): number {
  let n = 0;
  for (const b of blocks) {
    if (b.kind !== 'table') continue;
    n += 1;
    for (const row of b.rows) for (const cell of row.cells) n += countModelTables(cell.blocks);
  }
  return n;
}

/** Whether the WordprocessingML namespace URI is bound to a non-`w` prefix (or the
 *  default namespace) on ANY element, at any depth. The parser matches literal `w:`
 *  QNames, so such a document must fail closed to avoid silent data loss — including a
 *  table re-prefixed on a descendant (e.g. `t:tbl` with a local `xmlns:t`). */
export function hasNonWWordBinding(nodes: readonly XmlNode[]): boolean {
  for (const n of nodes) {
    if (!el(n)) continue;
    for (const [k, v] of Object.entries(n.attributes)) {
      if (v !== W_NS) continue;
      if (k === 'xmlns' || (k.startsWith('xmlns:') && k.slice(6) !== 'w')) return true;
    }
    if (hasNonWWordBinding(n.children)) return true;
  }
  return false;
}

/** Count top-level w:p/w:tbl blocks in the PARSED body tree, descending into
 *  block-level w:sdt exactly as the span scanner does. A disagreement between this
 *  count and the scanner's span count means the scanner mis-owns content, so the
 *  parse is rejected. */
export function countTreeBlocks(container: Extract<XmlNode, { type: 'element' }>): number {
  let n = 0;
  for (const child of container.children) {
    if (!el(child)) continue;
    if (child.name === 'w:p' || child.name === 'w:tbl') n += 1;
    else if (child.name === 'w:sdt') {
      const content = childElements(child, 'w:sdtContent')[0];
      if (content) n += countTreeBlocks(content);
    } else if (child.name === 'w:customXml') {
      n += countTreeBlocks(child);
    }
  }
  return n;
}

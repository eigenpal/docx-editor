// WordprocessingML element -> authored-model parsers (document-engine task 2.10).
// Reads the bounded, order-preserving XML tree into authored records: runs (through
// run wrappers), paragraphs, tables (structural, with prop parsers), and block-level
// SDTs (content controls); plus the block-span fragment builders and the tree-shape
// guards (table/SDT detection and counting, non-w namespace binding) the OPC
// orchestrator uses to fail closed. Secondary-part loaders (stories, styles, numbering)
// live in wml-parts. Treats all values as untrusted; no serialization/preservation here.

import { readXml, childElements, textContent, type XmlNode } from './xml-reader.ts';
import { type BlockSpan } from './wml-scan.ts';
import { IdentityAllocator } from '../model/identity.ts';
import {
  type Block,
  type ParagraphRecord,
  type ParagraphProps,
  type RunRecord,
  type RunProps,
  type TableRecord,
  type SdtRecord,
  type SdtProps,
  type SdtControlType,
  type SdtLock,
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
  const props: { styleId?: string; bold?: boolean; italic?: boolean } = {};
  if (rPr) {
    // Character-style link (w:rStyle) — the resolver's char-style layer. Formatting
    // toggles stay presence-only here to preserve the from-scratch serialize contract
    // (paragraphFullyCaptured already rejects runs with explicit-on/off b/i or an rStyle).
    const styleId = childElements(rPr, 'w:rStyle')[0]?.attributes['w:val'];
    if (styleId) props.styleId = styleId;
    if (childElements(rPr, 'w:b').length > 0) props.bold = true;
    if (childElements(rPr, 'w:i').length > 0) props.italic = true;
  }
  if (text.length === 0 && Object.keys(props).length === 0) return undefined;
  return Object.keys(props).length > 0 ? { text, props } : { text };
}

/** A boolean toggle rPr child (w:b/w:i): present with no val or a truthy val => true;
 *  explicit w:val of 0/false/off => false; absent => undefined (omitted/inherit). */
function toggleProp(rPr: Extract<XmlNode, { type: 'element' }>, name: string): boolean | undefined {
  const child = childElements(rPr, name)[0];
  if (!child) return undefined;
  const v = child.attributes['w:val'];
  if (v === undefined) return true;
  return !(v === '0' || v === 'false' || v === 'off');
}

/** Read run formatting (bold/italic/underline) from a w:rPr element, honoring explicit
 *  on/off. Shared by run, style, and docDefaults parsing. Every field is present only
 *  when the rPr sets it (absent => omitted/inherit). Underline: w:u @w:val="none" => off,
 *  any other value or bare presence => on. */
export function parseRPr(rPr: Extract<XmlNode, { type: 'element' }>): RunProps {
  const props: { bold?: boolean; italic?: boolean; underline?: boolean } = {};
  const b = toggleProp(rPr, 'w:b');
  if (b !== undefined) props.bold = b;
  const i = toggleProp(rPr, 'w:i');
  if (i !== undefined) props.italic = i;
  const u = childElements(rPr, 'w:u')[0];
  if (u) props.underline = u.attributes['w:val'] !== 'none';
  return props;
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

/** Authored paragraph properties from w:pPr (style link + list membership). Every field
 *  is present only when set (absent => omitted/inherit). Formatting VALUES stay omitted
 *  in authored state — the style resolver derives effective formatting, this only records
 *  the links (pStyle/numPr) resolution needs. */
function parseParagraphProps(pEl: Extract<XmlNode, { type: 'element' }>): ParagraphProps | undefined {
  const pPr = childElements(pEl, 'w:pPr')[0];
  if (!pPr) return undefined;
  const props: { styleId?: string; numId?: string; ilvl?: number } = {};
  const styleId = childElements(pPr, 'w:pStyle')[0]?.attributes['w:val'];
  if (styleId) props.styleId = styleId;
  const numPr = childElements(pPr, 'w:numPr')[0];
  if (numPr) {
    const numId = childElements(numPr, 'w:numId')[0]?.attributes['w:val'];
    if (numId) props.numId = numId;
    const ilvl = intAttr(childElements(numPr, 'w:ilvl')[0]?.attributes['w:val']);
    if (ilvl !== undefined) props.ilvl = ilvl;
  }
  return Object.keys(props).length > 0 ? props : undefined;
}

export function paragraphFromElement(pEl: Extract<XmlNode, { type: 'element' }>, alloc: IdentityAllocator): ParagraphRecord {
  const runs: RunRecord[] = [];
  for (const runEl of collectRunElements(pEl)) {
    const run = parseRun(runEl);
    if (run) runs.push(run);
  }
  const props = parseParagraphProps(pEl);
  return { kind: 'paragraph', id: alloc.allocate('paragraph'), runs, ...(props ? { props } : {}) };
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

// The discriminating child of w:sdtPr -> coarse control type. Namespaced names are
// kept verbatim by the reader (e.g. w14:checkbox, w15:repeatingSection). A Map (not a
// plain object) is used deliberately: element names are attacker-controlled, and a
// plain-object lookup on `constructor`/`__proto__`/`toString` would return an inherited
// prototype member (a function) instead of undefined and poison `controlType`.
const SDT_CONTROL_TYPES: ReadonlyMap<string, SdtControlType> = new Map([
  ['w:richText', 'richText'],
  ['w:text', 'text'],
  ['w:checkbox', 'checkbox'],
  ['w14:checkbox', 'checkbox'],
  ['w:dropDownList', 'dropDownList'],
  ['w:comboBox', 'comboBox'],
  ['w:date', 'date'],
  ['w:picture', 'picture'],
  ['w:docPartObj', 'docPartObj'],
  ['w:docPartList', 'docPartList'],
  ['w15:repeatingSection', 'repeatingSection'],
  ['w15:repeatingSectionItem', 'repeatingSectionItem'],
  ['w:citation', 'citation'],
  ['w:bibliography', 'bibliography'],
  ['w:group', 'group'],
  ['w:equation', 'equation'],
]);

const SDT_LOCKS: ReadonlySet<string> = new Set(['unlocked', 'sdtLocked', 'contentLocked', 'sdtContentLocked']);

/** Parse the semantic header of a content control from w:sdtPr. Exhaustive control
 *  payload (glyphs, list items, date/binding, w14/w15 props) is NOT modeled — it rides
 *  the SDT's verbatim preservation range; this captures only id/tag/alias/lock/type. */
function parseSdtProps(sdtPr: Extract<XmlNode, { type: 'element' }> | undefined): SdtProps {
  if (!sdtPr) return {};
  const props: {
    docId?: number;
    tag?: string;
    alias?: string;
    lock?: SdtLock;
    controlType?: SdtControlType;
    dataBinding?: boolean;
  } = {};
  const val = (name: string): string | undefined => {
    const child = childElements(sdtPr, name)[0];
    return child ? attr(child, 'w:val') : undefined;
  };
  const id = intAttr(val('w:id'));
  if (id !== undefined) props.docId = id;
  const tag = val('w:tag');
  if (tag !== undefined) props.tag = tag;
  const alias = val('w:alias');
  if (alias !== undefined) props.alias = alias;
  const lockVal = val('w:lock');
  if (lockVal !== undefined && SDT_LOCKS.has(lockVal)) props.lock = lockVal as SdtLock;
  for (const child of sdtPr.children) {
    if (!el(child)) continue;
    if (child.name === 'w:dataBinding') props.dataBinding = true;
    const ct = SDT_CONTROL_TYPES.get(child.name);
    if (ct && props.controlType === undefined) props.controlType = ct;
  }
  return props;
}

/** Structural blocks of an SDT's w:sdtContent (paragraphs, tables, nested SDTs),
 *  descending only the transparent w:customXml grouping wrapper. */
function parseSdtContentBlocks(content: Extract<XmlNode, { type: 'element' }>, alloc: IdentityAllocator): Block[] {
  const blocks: Block[] = [];
  for (const child of content.children) {
    if (!el(child)) continue;
    if (child.name === 'w:p') blocks.push(paragraphFromElement(child, alloc));
    else if (child.name === 'w:tbl') blocks.push(parseTable(child, alloc));
    else if (child.name === 'w:sdt') blocks.push(parseSdt(child, alloc));
    else if (child.name === 'w:customXml') blocks.push(...parseSdtContentBlocks(child, alloc));
  }
  return blocks;
}

/** Parse a block-level structured document tag (content control) structurally: its
 *  w:sdtPr header plus the nested w:sdtContent blocks. Never flattens. */
function parseSdt(sdt: Extract<XmlNode, { type: 'element' }>, alloc: IdentityAllocator): SdtRecord {
  const props = parseSdtProps(childElements(sdt, 'w:sdtPr')[0]);
  const content = childElements(sdt, 'w:sdtContent')[0];
  const blocks = content ? parseSdtContentBlocks(content, alloc) : [];
  return { kind: 'sdt', id: alloc.allocate('control'), props, blocks };
}

// ---- Block-kind parse registry (document-engine feature-lane contract). A new top-level
// block kind registers its OOXML element name and an element->Block parser here; the
// entry dispatch (blockFromText / blockFromSpan) then recognizes it WITHOUT editing a
// central switch. Registration is the parse half of a block kind's feature lane — the
// scanner (block-level span), tree counters, hash, serialize, normalize, projection, and
// layout are the other lanes a full feature also registers.

/** Turns a top-level block element (e.g. w:p / w:tbl / w:sdt) into an authored Block. */
export type BlockElementParser = (el: Extract<XmlNode, { type: 'element' }>, alloc: IdentityAllocator) => Block;

const blockElementParsers = new Map<string, BlockElementParser>();

/** Register the parser for a top-level block element. Later registration for the same
 *  element name replaces the earlier one (a feature may override a built-in). */
export function registerBlockElementParser(elementName: string, parse: BlockElementParser): void {
  blockElementParsers.set(elementName, parse);
}

/** The registered parser for a block element name, if any. */
export function blockElementParser(elementName: string): BlockElementParser | undefined {
  return blockElementParsers.get(elementName);
}

// Built-in block kinds.
registerBlockElementParser('w:p', paragraphFromElement);
registerBlockElementParser('w:tbl', parseTable);
registerBlockElementParser('w:sdt', parseSdt);

/** Build a block from a source substring (a top-level block element fragment). Dispatches
 *  through the block-kind parse registry; returns undefined for a parse failure or an
 *  unregistered root element, so callers can fail closed. */
export function blockFromText(text: string, alloc: IdentityAllocator): Block | undefined {
  const fx = readXml(text);
  if (!fx.ok) return undefined;
  const rootEl = fx.nodes.find(el);
  if (!rootEl) return undefined;
  return blockElementParsers.get(rootEl.name)?.(rootEl, alloc);
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
    if (b.kind === 'table') {
      n += 1;
      for (const row of b.rows) for (const cell of row.cells) n += countModelTables(cell.blocks);
    } else if (b.kind === 'sdt') {
      n += countModelTables(b.blocks); // a table nested inside a content control must still count
    }
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

/** Count top-level blocks in the PARSED body tree exactly as the span scanner counts
 *  spans: w:p, w:tbl, and a block-level w:sdt each count as ONE (the SDT is NOT
 *  descended — its content is one structural block); w:customXml is transparent and is
 *  descended. A disagreement between this count and the scanner's span count means the
 *  scanner mis-owns content, so the parse is rejected. */
export function countTreeBlocks(container: Extract<XmlNode, { type: 'element' }>): number {
  let n = 0;
  for (const child of container.children) {
    if (!el(child)) continue;
    if (child.name === 'w:p' || child.name === 'w:tbl' || child.name === 'w:sdt') n += 1;
    else if (child.name === 'w:customXml') {
      n += countTreeBlocks(child);
    }
  }
  return n;
}

/** Whether the parsed body tree contains a block-level w:sdt (content control) at top
 *  level, descending only the transparent w:customXml wrapper. Used to force the
 *  structural-preservation path so a content control is never flattened away. */
export function treeHasBlockSdt(container: Extract<XmlNode, { type: 'element' }>): boolean {
  for (const child of container.children) {
    if (!el(child)) continue;
    if (child.name === 'w:sdt') return true;
    if (child.name === 'w:customXml' && treeHasBlockSdt(child)) return true;
  }
  return false;
}

/** Whether a w:sdt holds BLOCK content (a w:p, w:tbl, or a nested block w:sdt) anywhere in
 *  its ENTIRE subtree, through ANY wrapper. DELIBERATELY broad and shape-agnostic: it
 *  powers the fail-closed net, whose job is to detect content that would be lost, not to
 *  mirror what the model captures. It scans the whole element (NOT only the first
 *  w:sdtContent) so lenient-but-malformed inputs — a second w:sdtContent, or a w:p placed
 *  directly under w:sdt — cannot smuggle block content past the net. A nested w:sdt counts
 *  as block content (projected as a nested SdtRecord on the structural path, so it must not
 *  vanish on the flat path). w:sdtPr holds only property elements, never w:p/w:tbl/w:sdt,
 *  so scanning it is harmless. An inline (run-content) SDT matches none and returns false. */
function sdtHasDeepBlockContent(sdt: Extract<XmlNode, { type: 'element' }>): boolean {
  const walk = (container: Extract<XmlNode, { type: 'element' }>): boolean => {
    for (const child of container.children) {
      if (!el(child)) continue;
      if (child.name === 'w:p' || child.name === 'w:tbl' || child.name === 'w:sdt') return true;
      if (walk(child)) return true;
    }
    return false;
  };
  return walk(sdt);
}

/** Whether a block-level content control (a w:sdt carrying block content) appears
 *  ANYWHERE in the subtree, including inside wrappers the structural traversals do NOT
 *  descend (w:ins, w:del, mc:AlternateContent, unknown foreign elements) AND when the
 *  block content itself sits under such a wrapper inside w:sdtContent. Used as a flat-path
 *  fail-closed net: on the non-preserved path a block SDT hidden this way would be
 *  silently dropped, so its presence must reject the document instead. */
export function deepHasBlockSdt(container: Extract<XmlNode, { type: 'element' }>): boolean {
  for (const child of container.children) {
    if (!el(child)) continue;
    if (child.name === 'w:sdt' && sdtHasDeepBlockContent(child)) return true;
    if (deepHasBlockSdt(child)) return true;
  }
  return false;
}

// Minimal OPC package reader/writer (document-engine tasks 2.7 partial, 3.6, 3.7).
// parseDocx: DOCX bytes -> authored PackageModel (body story paragraphs/runs +
// content types + root relationship). writeDocx: PackageModel -> valid minimal
// DOCX bytes. Attacker-derived text is XML-escaped on write; the reader goes
// through the bounded ZIP + XML trust boundary. This is the parse<->serialize
// round-trip that gate 5 (parse->edit->save->reopen) exercises.

import { readZip, writeZip, strToU8, strFromU8, type ZipRejection } from './zip.ts';
import { readXml, findElement, childElements, textContent, type XmlNode } from './xml-reader.ts';
import { escapeXml } from './sinks.ts';
import { resolveInternalTarget } from './opc-names.ts';
import { stableHash } from '../comparators/index.ts';
import {
  createEmptyModel,
  bodyStoryId,
  type PackageModel,
  type Story,
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
  type BlockRange,
  type PreservationState,
} from '../model/index.ts';
import { IdentityAllocator } from '../model/identity.ts';

/** The main document part; the only part with lossless range preservation today. */
const DOC_PART = '/word/document.xml';

/**
 * One canonical semantic hash of a top-level block, used identically by the parser
 * (to record a baseline) and the serializer (to decide verbatim reuse vs
 * regeneration). It covers the block's COMPLETE semantic subtree — a table hashes its
 * rows, cells, nested blocks, grid, and props.
 */
export function hashPreservableBlock(block: Block): string {
  return stableHash(block);
}

export type DocxParseRejection = ZipRejection | 'no-document' | 'xml-error';

export type ParseResult =
  | { readonly ok: true; readonly model: PackageModel }
  | { readonly ok: false; readonly reason: DocxParseRejection; readonly detail?: string };

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function el(node: XmlNode): node is Extract<XmlNode, { type: 'element' }> {
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
 * cell/content paragraphs. Structural table fidelity is a follow-up; this recovers
 * the text the review found was 100% lost.
 */
function collectParagraphElements(container: Extract<XmlNode, { type: 'element' }>): Extract<XmlNode, { type: 'element' }>[] {
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
function relatedStoryParts(entries: ReadonlyMap<string, Uint8Array>): { partName: string; spec: StorySpec }[] {
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

function parseStoryParagraphs(root: Extract<XmlNode, { type: 'element' }>, alloc: IdentityAllocator): ParagraphRecord[] {
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
function parseStyles(entries: ReadonlyMap<string, Uint8Array>): StyleRecord[] {
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
function parseNumbering(entries: ReadonlyMap<string, Uint8Array>): NumberingRecord[] {
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

// ===========================================================================
// Structural body blocks with lossless range preservation (task 2.7 / fidelity
// slice 1). Read-only semantic table projection with verbatim fragment reuse: the
// original document.xml text is retained and each top-level body block records a
// character RANGE into it, so an unedited document re-serializes byte-for-byte.
//
// OFFSETS ARE JAVASCRIPT STRING (UTF-16 CODE UNIT) INDICES into the original part
// text (a valid-UTF-8 decode of the part) — NOT byte offsets. The XML the scanner
// walks has already passed the bounded readXml well-formedness gate.
// ===========================================================================

const NAME_STOP = ' \t\r\n/>';

/** The element name at `<` position `lt` (handles the leading '/'); '' if none. */
function tagNameAt(s: string, lt: number): string {
  let i = lt + 1;
  if (s[i] === '/') i += 1;
  const start = i;
  while (i < s.length && !NAME_STOP.includes(s[i])) i += 1;
  return s.slice(start, i);
}

/** Index just past the '>' of the tag opening at `lt`, tracking attribute quotes. */
function openTagEnd(s: string, lt: number): { end: number; selfClosing: boolean } {
  let i = lt + 1;
  let quote = '';
  while (i < s.length) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return { end: i + 1, selfClosing: s[i - 1] === '/' };
    }
    i += 1;
  }
  return { end: s.length, selfClosing: false };
}

/** Index just past the end of the element opening at `lt` (well-formed input). */
function elementSpanEnd(s: string, lt: number): number {
  const open = openTagEnd(s, lt);
  if (open.selfClosing) return open.end;
  let depth = 1;
  let i = open.end;
  while (depth > 0 && i < s.length) {
    const nx = s.indexOf('<', i);
    if (nx < 0) return s.length;
    if (s.startsWith('<!--', nx)) {
      const e = s.indexOf('-->', nx);
      i = e < 0 ? s.length : e + 3;
    } else if (s.startsWith('<![CDATA[', nx)) {
      const e = s.indexOf(']]>', nx);
      i = e < 0 ? s.length : e + 3;
    } else if (s.startsWith('<?', nx)) {
      const e = s.indexOf('?>', nx);
      i = e < 0 ? s.length : e + 2;
    } else if (s[nx + 1] === '/') {
      const gt = s.indexOf('>', nx);
      i = gt < 0 ? s.length : gt + 1;
      depth -= 1;
    } else {
      const o = openTagEnd(s, nx);
      if (!o.selfClosing) depth += 1;
      i = o.end;
    }
  }
  return i;
}

/** First `<name ` opening whose full tag name matches, at or after `from`, before `before`. */
function findOpen(s: string, name: string, from: number, before: number): number {
  let i = from;
  for (;;) {
    const idx = s.indexOf('<' + name, i);
    if (idx < 0 || idx >= before) return -1;
    const after = s[idx + 1 + name.length];
    if (after === undefined || NAME_STOP.includes(after)) return idx;
    i = idx + 1;
  }
}

interface BlockSpan {
  readonly name: 'w:p' | 'w:tbl';
  readonly start: number;
  readonly end: number;
}

/** Emit spans for each w:p / w:tbl directly under [start,end), descending into
 *  block-level w:sdt > w:sdtContent so SDT-wrapped blocks are still projected. */
function walkBlockSpans(s: string, start: number, end: number, out: BlockSpan[]): void {
  let i = start;
  while (i < end) {
    const lt = s.indexOf('<', i);
    if (lt < 0 || lt >= end) break;
    if (s.startsWith('<!--', lt)) {
      const e = s.indexOf('-->', lt);
      i = e < 0 ? end : e + 3;
      continue;
    }
    if (s.startsWith('<?', lt)) {
      const e = s.indexOf('?>', lt);
      i = e < 0 ? end : e + 2;
      continue;
    }
    if (s[lt + 1] === '/') {
      const gt = s.indexOf('>', lt);
      i = gt < 0 ? end : gt + 1;
      continue;
    }
    const name = tagNameAt(s, lt);
    const span = elementSpanEnd(s, lt);
    if (name === 'w:p' || name === 'w:tbl') {
      out.push({ name, start: lt, end: Math.min(span, end) });
    } else if (name === 'w:sdt') {
      const cOpen = findOpen(s, 'w:sdtContent', lt, span);
      if (cOpen >= 0) {
        const inner = openTagEnd(s, cOpen).end;
        const cEnd = elementSpanEnd(s, cOpen);
        const closeAt = s.lastIndexOf('</w:sdtContent', cEnd);
        walkBlockSpans(s, inner, closeAt < 0 ? cEnd : closeAt, out);
      }
    }
    i = span;
  }
}

/** Ordered spans of every top-level body block (w:p / w:tbl) in document.xml text. */
function scanBodyBlockSpans(docText: string): BlockSpan[] {
  const bodyLt = findOpen(docText, 'w:body', 0, docText.length);
  if (bodyLt < 0) return [];
  const contentStart = openTagEnd(docText, bodyLt).end;
  const bodyEnd = elementSpanEnd(docText, bodyLt);
  const closeAt = docText.lastIndexOf('</w:body', bodyEnd);
  const out: BlockSpan[] = [];
  walkBlockSpans(docText, contentStart, closeAt < 0 ? bodyEnd : closeAt, out);
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
  const gb = childElements(trPr, 'w:gridBefore')[0]?.attributes['w:val'];
  const ga = childElements(trPr, 'w:gridAfter')[0]?.attributes['w:val'];
  const props: TableRowProps = {
    ...(childElements(trPr, 'w:tblHeader').length > 0 ? { isHeader: true } : {}),
    ...(childElements(trPr, 'w:cantSplit').length > 0 ? { cantSplit: true } : {}),
    ...(h?.attributes['w:val'] !== undefined ? { height: h.attributes['w:val'] } : {}),
    ...(h?.attributes['w:hRule'] !== undefined ? { heightRule: h.attributes['w:hRule'] } : {}),
    ...(gb !== undefined ? { gridBefore: Number(gb) } : {}),
    ...(ga !== undefined ? { gridAfter: Number(ga) } : {}),
    ...(parseWidth(childElements(trPr, 'w:wBefore')[0]) ? { widthBefore: parseWidth(childElements(trPr, 'w:wBefore')[0])! } : {}),
    ...(parseWidth(childElements(trPr, 'w:wAfter')[0]) ? { widthAfter: parseWidth(childElements(trPr, 'w:wAfter')[0])! } : {}),
  };
  return Object.keys(props).length > 0 ? props : undefined;
}

function parseCellProps(tcPr: Extract<XmlNode, { type: 'element' }> | undefined): TableCellProps | undefined {
  if (!tcPr) return undefined;
  const gridSpan = tcPr && childElements(tcPr, 'w:gridSpan')[0]?.attributes['w:val'];
  const vMergeEl = childElements(tcPr, 'w:vMerge')[0];
  const vMerge: VMerge | undefined = vMergeEl ? (vMergeEl.attributes['w:val'] !== undefined ? { val: vMergeEl.attributes['w:val'] } : {}) : undefined;
  const props: TableCellProps = {
    ...(parseWidth(childElements(tcPr, 'w:tcW')[0]) ? { width: parseWidth(childElements(tcPr, 'w:tcW')[0])! } : {}),
    ...(gridSpan !== undefined ? { gridSpan: Number(gridSpan) } : {}),
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

function paragraphFromElement(pEl: Extract<XmlNode, { type: 'element' }>, alloc: IdentityAllocator): ParagraphRecord {
  const runs: RunRecord[] = [];
  for (const runEl of collectRunElements(pEl)) {
    const run = parseRun(runEl);
    if (run) runs.push(run);
  }
  return { kind: 'paragraph', id: alloc.allocate('paragraph'), runs };
}

/** Parse the direct block children (w:p / nested w:tbl) of a cell. */
function cellBlocks(tc: Extract<XmlNode, { type: 'element' }>, alloc: IdentityAllocator): Block[] {
  const blocks: Block[] = [];
  for (const child of tc.children) {
    if (!el(child)) continue;
    if (child.name === 'w:p') blocks.push(paragraphFromElement(child, alloc));
    else if (child.name === 'w:tbl') blocks.push(parseTable(child, alloc));
  }
  return blocks;
}

function parseTable(tbl: Extract<XmlNode, { type: 'element' }>, alloc: IdentityAllocator): TableRecord {
  const tblPr = childElements(tbl, 'w:tblPr')[0];
  const gridEl = childElements(tbl, 'w:tblGrid')[0];
  const grid: GridColumn[] = gridEl
    ? childElements(gridEl, 'w:gridCol').map((c) => (c.attributes['w:w'] !== undefined ? { w: c.attributes['w:w'] } : {}))
    : [];
  const rows: TableRowRecord[] = childElements(tbl, 'w:tr').map((tr) => {
    const trPr = childElements(tr, 'w:trPr')[0];
    const cells: TableCellRecord[] = childElements(tr, 'w:tc').map((tc) => {
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

/** Build a block from its source substring (well-formed w:p / w:tbl fragment). */
function blockFromSpan(docText: string, span: BlockSpan, alloc: IdentityAllocator): Block | undefined {
  const fx = readXml(docText.slice(span.start, span.end));
  if (!fx.ok) return undefined;
  const rootEl = fx.nodes.find(el);
  if (!rootEl) return undefined;
  return span.name === 'w:tbl' ? parseTable(rootEl, alloc) : paragraphFromElement(rootEl, alloc);
}

/** Validate the range index: integer, in-bounds, block exists, non-overlapping per part. */
function validateRanges(model: PackageModel): void {
  const p = model.preservation;
  if (!p) return;
  const ids = new Set<string>();
  for (const story of model.stories.values()) for (const b of story.blocks) ids.add(b.id);
  const byPart = new Map<string, BlockRange[]>();
  for (const [blockId, r] of p.blockRanges) {
    if (!ids.has(blockId)) throw new Error(`preservation range references missing block ${blockId}`);
    const text = p.originalParts.get(r.partName);
    if (text === undefined) throw new Error(`preservation range for ${blockId} references unknown part ${r.partName}`);
    if (!Number.isInteger(r.start) || !Number.isInteger(r.end)) throw new Error(`non-integer range for ${blockId}`);
    if (!(r.start >= 0 && r.start < r.end && r.end <= text.length)) throw new Error(`out-of-bounds range for ${blockId}`);
    (byPart.get(r.partName) ?? byPart.set(r.partName, []).get(r.partName)!).push(r);
  }
  for (const ranges of byPart.values()) {
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].start < sorted[i - 1].end) throw new Error('overlapping preservation ranges in one part');
    }
  }
}

export function parseDocx(bytes: Uint8Array): ParseResult {
  const zip = readZip(bytes);
  if (!zip.ok) return { ok: false, reason: zip.reason, detail: zip.detail };
  const docPart = zip.entries.get('/word/document.xml');
  if (!docPart) return { ok: false, reason: 'no-document' };

  const docText = strFromU8(docPart);
  const xml = readXml(docText);
  if (!xml.ok) return { ok: false, reason: 'xml-error', detail: xml.reason };

  const body = findElement(xml.nodes, 'w:body');
  const alloc = new IdentityAllocator();
  const storyId = alloc.allocate('story');

  // A body containing a table is parsed STRUCTURALLY from source spans, and its
  // original document.xml text + per-block ranges are retained for lossless re-emit.
  // A table-free body keeps the existing flat paragraph parse (no preservation),
  // leaving those documents byte-for-byte unchanged in behavior.
  const spans = scanBodyBlockSpans(docText);
  const blocks: Block[] = [];
  let preservation: PreservationState | undefined;
  if (spans.some((s) => s.name === 'w:tbl')) {
    const blockRanges = new Map<string, BlockRange>();
    for (const span of spans) {
      const block = blockFromSpan(docText, span, alloc);
      if (!block) continue;
      blocks.push(block);
      blockRanges.set(block.id, { partName: DOC_PART, start: span.start, end: span.end, baselineHash: hashPreservableBlock(block) });
    }
    preservation = { originalParts: new Map([[DOC_PART, docText]]), blockRanges };
  } else if (body) {
    for (const p of collectParagraphElements(body)) blocks.push(paragraphFromElement(p, alloc));
  }
  if (blocks.length === 0) blocks.push({ kind: 'paragraph', id: alloc.allocate('paragraph'), runs: [] });

  const base = createEmptyModel();
  const stories = new Map<string, Story>();
  stories.set(storyId, { id: storyId, kind: 'body', blocks });

  // Related stories: header/footer/footnote/endnote/comment (OOXML-review gap #5)
  // — text previously lost because only word/document.xml was read.
  for (const { partName, spec } of relatedStoryParts(zip.entries)) {
    const part = zip.entries.get(partName);
    if (!part) continue;
    const sx = readXml(strFromU8(part));
    if (!sx.ok) continue;
    const root = findElement(sx.nodes, spec.root);
    if (!root) continue;
    // Note/comment collections wrap each entry (w:footnote/w:endnote/w:comment);
    // header/footer content is directly under the root.
    const containers = spec.item ? childElements(root, spec.item) : [root];
    const blocks: ParagraphRecord[] = [];
    for (const container of containers) blocks.push(...parseStoryParagraphs(container, alloc));
    const sid = alloc.allocate('story');
    stories.set(sid, { id: sid, kind: spec.kind, blocks });
  }

  const styles = parseStyles(zip.entries);
  const numbering = parseNumbering(zip.entries);
  const model: PackageModel = {
    ...base,
    stories,
    styles: styles.length > 0 ? styles : base.styles,
    numbering,
    identity: alloc.state(),
    ...(preservation ? { preservation } : {}),
  };
  validateRanges(model); // integer/in-bounds/exists/non-overlapping
  return { ok: true, model };
}

function runXml(run: RunRecord): string {
  const props = run.props;
  const rPr =
    props?.bold || props?.italic
      ? `<w:rPr>${props.bold ? '<w:b/>' : ''}${props.italic ? '<w:i/>' : ''}</w:rPr>`
      : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
}

function paragraphXml(p: ParagraphRecord): string {
  return `<w:p>${p.runs.map(runXml).join('')}</w:p>`;
}

/** Regenerate one block's XML. Paragraphs are supported; a TABLE cannot be
 *  regenerated yet, so an edited table/cell fails closed (its verbatim range is only
 *  reused while unchanged). */
function blockXml(block: Block): string {
  if (block.kind === 'paragraph') return paragraphXml(block);
  throw new Error('table/cell editing must fail closed: table regeneration is not implemented (fidelity slice 1)');
}

/**
 * Serialize the body story into a document.xml string. When the model retains the
 * original part (a table document), start from that text and re-emit only the ranges
 * whose block hash changed — everything else (root namespaces, whitespace, siblings)
 * stays verbatim, so an UNEDITED document is byte-identical. Structural changes to a
 * preserved document (a top-level block added, removed, or reordered) fail closed.
 * A document with no retained original (created from scratch) regenerates a minimal body.
 */
export function documentXml(model: PackageModel): string {
  const original = model.preservation?.originalParts.get(DOC_PART);
  if (original !== undefined) return patchDocumentPart(model, original, model.preservation!.blockRanges);

  const story = model.stories.get(bodyStoryId(model))!;
  const body = story.blocks.map(blockXml).join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`
  );
}

function patchDocumentPart(model: PackageModel, original: string, ranges: ReadonlyMap<string, BlockRange>): string {
  const bodyStory = model.stories.get(bodyStoryId(model))!;
  const docRanges = [...ranges].filter(([, r]) => r.partName === DOC_PART).sort((a, b) => a[1].start - b[1].start);
  const rangeOrder = docRanges.map(([id]) => id);
  const bodyIds = bodyStory.blocks.map((b) => b.id);
  // Same ids in the same order = no add/remove/reorder. Anything else is a structural
  // op we cannot patch yet -> fail closed.
  if (bodyIds.length !== rangeOrder.length || bodyIds.some((id, i) => id !== rangeOrder[i])) {
    throw new Error('structural change to a preserved document (block added, removed, or reordered) must fail closed until regeneration exists');
  }
  const byId = new Map(bodyStory.blocks.map((b) => [b.id, b] as const));
  const patches: { start: number; end: number; xml: string }[] = [];
  for (const [id, r] of docRanges) {
    const block = byId.get(id)!;
    if (hashPreservableBlock(block) !== r.baselineHash) patches.push({ start: r.start, end: r.end, xml: blockXml(block) });
  }
  patches.sort((a, b) => b.start - a.start); // highest offset first so earlier offsets stay valid
  let out = original;
  for (const p of patches) out = out.slice(0, p.start) + p.xml + out.slice(p.end);
  return out;
}

const CONTENT_TYPES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `</Types>`;

const ROOT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

/** Serialize a PackageModel into valid minimal DOCX bytes. */
export function writeDocx(model: PackageModel): Uint8Array {
  const entries = new Map<string, Uint8Array>([
    ['/[Content_Types].xml', strToU8(CONTENT_TYPES_XML)],
    ['/_rels/.rels', strToU8(ROOT_RELS_XML)],
    ['/word/document.xml', strToU8(documentXml(model))],
  ]);
  return writeZip(entries);
}

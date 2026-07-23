// Minimal OPC package reader/writer (document-engine tasks 2.7 partial, 3.6, 3.7).
// parseDocx: DOCX bytes -> authored PackageModel (body story paragraphs/runs +
// content types + root relationship). writeDocx: PackageModel -> valid minimal
// DOCX bytes. Attacker-derived text is XML-escaped on write; the reader goes
// through the bounded ZIP + XML trust boundary. This is the parse<->serialize
// round-trip that gate 5 (parse->edit->save->reopen) exercises.

import { readZip, writeZip, strToU8, strFromU8, type ZipRejection } from './zip.ts';
import { readXml, findElement, childElements, textContent, type XmlNode } from './xml-reader.ts';
import { scanBodyBlockSpans, scanCellParagraphSpans, ScanError, type BlockSpan } from './wml-scan.ts';
import { paragraphXml, blockXml } from './wml-serialize.ts';
import {
  W_NS, el, collectParagraphElements, relatedStoryParts, parseStoryParagraphs,
  parseStyles, parseNumbering, paragraphFromElement, blockFromText, blockFromSpan,
  treeHasTable, deepHasTable, deepCountTables, countModelTables, hasNonWWordBinding,
  countTreeBlocks,
} from './wml-parse.ts';
import { stableHash } from '../comparators/index.ts';
import {
  createEmptyModel,
  bodyStoryId,
  type PackageModel,
  type Story,
  type Block,
  type ParagraphRecord,
  type TableRecord,
  type BlockRange,
  type PreservationState,
  validatePreservation,
} from '../model/index.ts';
import { IdentityAllocator } from '../model/identity.ts';

/** The main document part; the only part with lossless range preservation today. */
const DOC_PART = '/word/document.xml';

/** Content view of a block with all stable IDs stripped, so the hash reflects
 *  semantic CONTENT and is stable across a re-parse (which allocates fresh ids). */
function contentForHash(block: Block): unknown {
  if (block.kind === 'paragraph') {
    return { kind: 'paragraph', runs: block.runs, ...(block.props ? { props: block.props } : {}) };
  }
  return {
    kind: 'table',
    ...(block.grid ? { grid: block.grid } : {}),
    ...(block.props ? { props: block.props } : {}),
    rows: block.rows.map((r) => ({
      ...(r.props ? { props: r.props } : {}),
      cells: r.cells.map((c) => ({
        ...(c.props ? { props: c.props } : {}),
        blocks: c.blocks.map(contentForHash),
      })),
    })),
  };
}

/**
 * One canonical semantic hash of a top-level block, used identically by the parser
 * (baseline) and the serializer (edit detection + slice re-binding). It covers the
 * block's COMPLETE semantic subtree — a table hashes its rows, cells, nested blocks,
 * grid, and props — and is ID-INDEPENDENT so re-parsing the same source slice yields
 * the same hash.
 */
export function hashPreservableBlock(block: Block): string {
  return stableHash(contentForHash(block));
}

export type DocxParseRejection = ZipRejection | 'no-document' | 'xml-error';

export type ParseResult =
  | { readonly ok: true; readonly model: PackageModel }
  | { readonly ok: false; readonly reason: DocxParseRejection; readonly detail?: string };

export function parseDocx(bytes: Uint8Array): ParseResult {
  const zip = readZip(bytes);
  if (!zip.ok) return { ok: false, reason: zip.reason, detail: zip.detail };
  const docPart = zip.entries.get('/word/document.xml');
  if (!docPart) return { ok: false, reason: 'no-document' };

  const docText = strFromU8(docPart);
  const xml = readXml(docText);
  if (!xml.ok) return { ok: false, reason: 'xml-error', detail: xml.reason };

  // Reject a document that binds the WordprocessingML namespace to a non-`w` prefix
  // (or the default namespace) ANYWHERE in the tree. The parser matches literal `w:`
  // QNames, so such a document — including a table re-prefixed on a descendant — would
  // otherwise silently lose content; fail closed until names are resolved by URI.
  if (hasNonWWordBinding(xml.nodes)) {
    return { ok: false, reason: 'xml-error', detail: 'wordprocessingml bound to a non-w namespace prefix (unsupported)' };
  }

  const body = findElement(xml.nodes, 'w:body');
  const alloc = new IdentityAllocator();
  const storyId = alloc.allocate('story');

  // A body containing a table is parsed STRUCTURALLY from source spans, and its
  // original document.xml text + per-block ranges are retained for lossless re-emit.
  // A table-free body keeps the existing flat paragraph parse (no preservation),
  // leaving those documents byte-for-byte unchanged in behavior.
  // Scan block spans strictly; a ScanError means malformed XML the lenient reader
  // accepted (mismatched/unclosed tags), so preservation cannot be trusted.
  let spans: BlockSpan[] | null;
  try {
    spans = scanBodyBlockSpans(docText);
  } catch (e) {
    if (!(e instanceof ScanError)) throw e;
    spans = null;
  }
  const wantsPreservation = (body ? treeHasTable(body) : false) || (spans?.some((s) => s.name === 'w:tbl') ?? false);
  // Safety net: a table exists somewhere but the block traversals (which descend only
  // through known wrappers w:sdt/w:customXml) did not reach it — fail closed rather
  // than silently drop it on the flat path.
  if (body && !wantsPreservation && deepHasTable(body)) {
    return { ok: false, reason: 'xml-error', detail: 'table in an unsupported container (fail closed)' };
  }
  const blocks: Block[] = [];
  let preservation: PreservationState | undefined;
  if (wantsPreservation) {
    // A table document MUST scan cleanly and its spans MUST match the parsed tree's
    // top-level blocks exactly, or ranges could mis-own content (guards decoy tags in
    // comments, malformed nesting, and the reader's non-strict well-formedness). Any
    // failure rejects the document rather than falling back to a lossy flat parse.
    if (!spans || !body) return { ok: false, reason: 'xml-error', detail: 'table document failed strict span scan' };
    const blockRanges = new Map<string, BlockRange>();
    for (const span of spans) {
      const block = blockFromSpan(docText, span, alloc);
      if (!block) return { ok: false, reason: 'xml-error', detail: 'table preservation fragment parse failed' };
      blocks.push(block);
      blockRanges.set(block.id, { partName: DOC_PART, start: span.start, end: span.end, baselineHash: hashPreservableBlock(block) });
    }
    if (blocks.length !== spans.length || countTreeBlocks(body) !== blocks.length) {
      return { ok: false, reason: 'xml-error', detail: 'table preservation scan/tree mismatch' };
    }
    // Every source table MUST be projected into the model — even when one reachable
    // table already activated preservation, a second table hidden in an unsupported
    // wrapper would leave semantic addressability silently incomplete. Fail closed.
    if (deepCountTables(body) !== countModelTables(blocks)) {
      return { ok: false, reason: 'xml-error', detail: 'a table is not projected (hidden in an unsupported container)' };
    }
    preservation = { originalParts: new Map([[DOC_PART, docText]]), blockRanges, packageParts: new Map(zip.entries) };
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
  validatePreservation(model); // integer/in-bounds/exists/non-overlapping
  return { ok: true, model };
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
  if (original !== undefined) {
    validatePreservation(model); // re-validate at the serialize boundary, not only at parse
    return emitPreservedPart(model, original, model.preservation!.blockRanges);
  }
  const story = model.stories.get(bodyStoryId(model))!;
  const body = story.blocks.map(blockXml).join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`
  );
}

/** Cell paragraphs of a SIMPLE table (w:tr › w:tc › w:p only) in document order, or
 *  null if any cell holds a nested table / non-paragraph block (edit unsupported). */
function simpleCellParagraphs(table: TableRecord): ParagraphRecord[] | null {
  const out: ParagraphRecord[] = [];
  for (const row of table.rows) {
    for (const cell of row.cells) {
      for (const b of cell.blocks) {
        if (b.kind !== 'paragraph') return null;
        out.push(b);
      }
    }
  }
  return out;
}

/** Table structure/props hash with cell paragraph CONTENT stripped — so a change here
 *  means rows/cells/props/grid changed (structural), not just cell text. */
function tableSkeleton(table: TableRecord): unknown {
  return {
    ...(table.grid ? { grid: table.grid } : {}),
    ...(table.props ? { props: table.props } : {}),
    rows: table.rows.map((r) => ({
      ...(r.props ? { props: r.props } : {}),
      cells: r.cells.map((c) => ({
        ...(c.props ? { props: c.props } : {}),
        blocks: c.blocks.map((b) => (b.kind === 'table' ? tableSkeleton(b) : { kind: 'paragraph' })),
      })),
    })),
  };
}

/**
 * Whether a paragraph is regenerable BYTE-FAITHFULLY from the model, so patching it
 * drops or misrepresents nothing. STRICT — the model only captures w:t text and
 * bold/italic PRESENCE, so this rejects anything the regenerator (`paragraphXml`)
 * cannot reproduce exactly:
 *  - any paragraph attribute (rsid…) or w:pPr or non-w:r child;
 *  - any w:r attribute;
 *  - a w:tab/w:br/w:cr/w:noBreakHyphen (regen would flatten it to a literal char);
 *  - w:b/w:i with ANY attribute (an explicit w:val="0"/"false" would flip to enabled);
 *  - any other w:rPr child, or a w:t attribute other than xml:space;
 *  - an empty run (no non-empty w:t) that the model drops or that would gain a w:t.
 */
function paragraphFullyCaptured(pEl: Extract<XmlNode, { type: 'element' }>): boolean {
  if (Object.keys(pEl.attributes).length > 0) return false;
  for (const c of pEl.children) {
    if (c.type === 'text') { if (c.value.trim() !== '') return false; continue; }
    if (c.name !== 'w:r' || Object.keys(c.attributes).length > 0) return false;
    let hasText = false;
    let tCount = 0;
    for (const rc of c.children) {
      if (rc.type === 'text') { if (rc.value.trim() !== '') return false; continue; }
      if (rc.name === 'w:rPr') {
        for (const pr of rc.children) {
          if (pr.type === 'text') { if (pr.value.trim() !== '') return false; continue; }
          if (pr.name !== 'w:b' && pr.name !== 'w:i') return false; // only b/i are modeled
          if (Object.keys(pr.attributes).length > 0) return false; // explicit on/off not modeled
        }
      } else if (rc.name === 'w:t') {
        tCount += 1;
        if (tCount > 1) return false; // multiple w:t collapse into one on regen (segmentation lost)
        if (Object.keys(rc.attributes).some((k) => k !== 'xml:space')) return false;
        if (textContent(rc).length > 0) hasText = true;
      } else {
        return false; // w:tab/w:br/w:cr/w:noBreakHyphen or anything else is not regenerable
      }
    }
    if (!hasText) return false; // an empty run is dropped / would gain an added <w:t>
  }
  return true;
}

/** Patch an EDITED table by regenerating only its changed cell paragraphs (the
 *  smallest owned range), leaving all other bytes verbatim. Returns absolute-offset
 *  patches, or null to FAIL CLOSED (nested/complex table, structural/prop change, a
 *  changed cell paragraph that is not fully captured, or a span/model mismatch). */
function patchEditedTable(tableText: string, tableStart: number, baseline: TableRecord, current: TableRecord): { start: number; end: number; xml: string }[] | null {
  const baseParas = simpleCellParagraphs(baseline);
  const curParas = simpleCellParagraphs(current);
  if (!baseParas || !curParas || baseParas.length !== curParas.length) return null;
  if (stableHash(tableSkeleton(baseline)) !== stableHash(tableSkeleton(current))) return null; // structure/props changed
  const spans = scanCellParagraphSpans(tableText);
  if (spans.length !== baseParas.length) return null; // wrapped rows / mismatch -> fail closed
  const patches: { start: number; end: number; xml: string }[] = [];
  for (let i = 0; i < curParas.length; i += 1) {
    if (hashPreservableBlock(curParas[i]) === hashPreservableBlock(baseParas[i])) continue; // unchanged
    const origP = readXml(tableText.slice(spans[i].start, spans[i].end));
    const pEl = origP.ok ? origP.nodes.find(el) : undefined;
    if (!pEl || !paragraphFullyCaptured(pEl)) return null; // would drop unmodeled content
    patches.push({ start: tableStart + spans[i].start, end: tableStart + spans[i].end, xml: paragraphXml(curParas[i]) });
  }
  return patches;
}

/**
 * Re-emit a preserved part. UNCHANGED blocks are emitted verbatim. A changed TABLE is
 * patched at the level of its EDITED CELL PARAGRAPHS only (the smallest owned range) —
 * the table's structure/props and every other byte stay verbatim; anything that would
 * drop content (structural table change, a non-fully-captured cell, a changed
 * paragraph block, add/remove/reorder) FAILS CLOSED. Each baseline hash is re-bound to
 * its current source slice so a tampered/drifted snapshot is rejected.
 */
function emitPreservedPart(model: PackageModel, original: string, ranges: ReadonlyMap<string, BlockRange>): string {
  const bodyStory = model.stories.get(bodyStoryId(model))!;
  const docRanges = [...ranges].filter(([, r]) => r.partName === DOC_PART).sort((a, b) => a[1].start - b[1].start);
  const rangeOrder = docRanges.map(([id]) => id);
  const bodyIds = bodyStory.blocks.map((b) => b.id);
  if (bodyIds.length !== rangeOrder.length || bodyIds.some((id, i) => id !== rangeOrder[i])) {
    throw new Error('structural change to a preserved document (block added, removed, or reordered) must fail closed until regeneration exists');
  }
  const byId = new Map(bodyStory.blocks.map((b) => [b.id, b] as const));
  const throwaway = new IdentityAllocator();
  const patches: { start: number; end: number; xml: string }[] = [];
  for (const [id, r] of docRanges) {
    const sliceText = original.slice(r.start, r.end);
    const reparsed = blockFromText(sliceText, throwaway);
    if (!reparsed || hashPreservableBlock(reparsed) !== r.baselineHash) {
      throw new Error(`preservation range for block ${id} does not match its baseline hash (tampered or drifted snapshot)`);
    }
    const block = byId.get(id)!;
    if (hashPreservableBlock(block) === r.baselineHash) continue; // unchanged -> verbatim
    if (block.kind === 'table' && reparsed.kind === 'table') {
      const cellPatches = patchEditedTable(sliceText, r.start, reparsed, block);
      if (!cellPatches) throw new Error(`table ${id} was edited structurally or in unmodeled content — fail closed`);
      patches.push(...cellPatches);
    } else {
      throw new Error(`preserved block ${id} was edited; only cell-paragraph edits regenerate — fail closed`);
    }
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

/**
 * Serialize a PackageModel into DOCX bytes. When the model retains the original
 * package (a parsed document), EVERY part is re-emitted byte-for-byte and only the
 * main document part is patched from the preservation index — so an unedited document
 * round-trips losslessly (styles, rels, media, headers all survive). A model with no
 * retained package (created from scratch) emits a valid minimal document.
 */
export function writeDocx(model: PackageModel): Uint8Array {
  const parts = model.preservation?.packageParts;
  if (parts && parts.size > 0) {
    const entries = new Map(parts);
    entries.set(DOC_PART, strToU8(documentXml(model))); // patch only the main document part
    return writeZip(entries);
  }
  const entries = new Map<string, Uint8Array>([
    ['/[Content_Types].xml', strToU8(CONTENT_TYPES_XML)],
    ['/_rels/.rels', strToU8(ROOT_RELS_XML)],
    ['/word/document.xml', strToU8(documentXml(model))],
  ]);
  return writeZip(entries);
}

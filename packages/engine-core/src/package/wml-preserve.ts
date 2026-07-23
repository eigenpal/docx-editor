// Lossless part preservation for WordprocessingML (document-engine task 2.10, spec
// lossless-package-model). Owns the id-independent block content hash, the fail-closed
// paragraph-capture guard, and the verbatim re-emit path: unchanged blocks are emitted
// byte-for-byte; an edited table is patched at the level of its changed cell paragraphs
// only (the smallest owned range); anything that would drop or misrepresent content
// FAILS CLOSED. No OPC/ZIP orchestration here.

import { readXml, textContent, type XmlNode } from './xml-reader.ts';
import { scanCellParagraphSpans } from './wml-scan.ts';
import { paragraphXml } from './wml-serialize.ts';
import { el, blockFromText } from './wml-parse.ts';
import { IdentityAllocator } from '../model/identity.ts';
import { blockHashContent } from '../model/index.ts';
import { stableHash } from '../comparators/index.ts';
import {
  bodyStoryId,
  type PackageModel,
  type Block,
  type ParagraphRecord,
  type TableRecord,
  type BlockRange,
} from '../model/index.ts';

/** The main document part; the only part with lossless range preservation today. */
export const DOC_PART = '/word/document.xml';

/** Content view of a block with all stable IDs stripped, so the hash reflects
 *  semantic CONTENT and is stable across a re-parse (which allocates fresh ids). */
// Identity-stripped content view for the hash. Each block kind's shape is owned by its registered
// core capability (comprehensive 3.3); this dispatches through the registry and recurses nested
// blocks through the SAME path, so a new kind is hashed by registering a capability, not by editing
// a switch. Paragraph runs are hashed NORMALIZED (comprehensive 3.10) inside the capability.
function contentForHash(block: Block): unknown {
  return blockHashContent(block, contentForHash);
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

/** EXACT hash of a block's original source-slice bytes (integrity/rebinding), independent of the
 *  normalized semantic hash: it detects a drifted/tampered slice that still normalizes equal. */
export function hashSourceSlice(sliceText: string): string {
  return stableHash(sliceText);
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
/** Whether a raw source slice is EXACTLY a single, fully-captured paragraph with NOTHING the
 *  reader silently drops. readXml discards XML comments and processing instructions, so a
 *  paragraph carrying `<!-- … -->` or `<? … ?>` would pass the element-level check yet lose
 *  that content on regeneration — the raw markers are rejected here. The slice must ALSO be a
 *  lone `w:p`: a range drawn to swallow a following sibling (a `w:bookmarkStart`, an SDT
 *  boundary, stray text) is rejected, since regeneration re-emits only the paragraph and would
 *  delete everything else the range covered. */
export function sliceIsFullyCapturedParagraph(sliceText: string): boolean {
  if (sliceText.includes('<!--') || sliceText.includes('<?')) return false; // comment / PI would be dropped
  // readXml discards top-level text OUTSIDE elements, so raw content before or after the
  // paragraph (a swallowed `KEEP<w:p>…` or `…</w:p>trailing`) is invisible to a node scan yet
  // lost on regeneration. Require the trimmed slice to BEGIN and END exactly at the paragraph
  // element (an empty paragraph may be self-closed `<w:p/>`); trailing whitespace is fine.
  const t = sliceText.trim();
  if (!t.startsWith('<w:p')) return false;
  if (!t.endsWith('</w:p>') && !t.endsWith('/>')) return false;
  const fx = readXml(sliceText);
  if (!fx.ok) return false;
  const els = fx.nodes.filter(el);
  if (els.length !== 1) return false; // zero, or a swallowed sibling element → fail closed
  return els[0].name === 'w:p' && paragraphFullyCaptured(els[0]);
}

export function paragraphFullyCaptured(pEl: Extract<XmlNode, { type: 'element' }>): boolean {
  if (Object.keys(pEl.attributes).length > 0) return false;
  for (const c of pEl.children) {
    if (c.type === 'text') { if (c.value.trim() !== '') return false; continue; }
    if (c.name !== 'w:r' || Object.keys(c.attributes).length > 0) return false;
    let hasText = false;
    let tCount = 0;
    let rPrCount = 0;
    for (const rc of c.children) {
      if (rc.type === 'text') { if (rc.value.trim() !== '') return false; continue; }
      if (rc.name === 'w:rPr') {
        rPrCount += 1;
        if (rPrCount > 1) return false; // only the FIRST w:rPr is read on parse; a second would be dropped
        for (const pr of rc.children) {
          if (pr.type === 'text') { if (pr.value.trim() !== '') return false; continue; }
          if (pr.name !== 'w:b' && pr.name !== 'w:i') return false; // only b/i are modeled
          if (Object.keys(pr.attributes).length > 0) return false; // explicit on/off not modeled
        }
      } else if (rc.name === 'w:t') {
        tCount += 1;
        if (tCount > 1) return false; // multiple w:t collapse into one on regen (segmentation lost)
        // The regenerator emits xml:space="preserve" (never "default"); any other xml:space
        // value would be rewritten and change whitespace semantics, so accept only "preserve".
        for (const k of Object.keys(rc.attributes)) {
          if (k !== 'xml:space' || rc.attributes[k] !== 'preserve') return false;
        }
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
    // Guard the RAW slice, not a parsed node: readXml discards comments/PIs, so a cell
    // paragraph carrying <!-- --> or <? ?> must fail closed here too — regenerating it would
    // silently delete that content.
    if (!sliceIsFullyCapturedParagraph(tableText.slice(spans[i].start, spans[i].end))) return null;
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
/**
 * Regenerate the block region of a preserved document.xml after a STRUCTURAL body edit.
 * Lossless only when (a) every ORIGINAL block was a fully-captured paragraph whose slice
 * still matches its baseline hash (no drift/tamper, nothing unmodeled to drop) and (b)
 * every CURRENT block is a paragraph (regenerable via paragraphXml). Otherwise fails
 * closed. Everything before the first block and after the last (a trailing w:sectPr, the
 * body/document close) is spliced back verbatim; only the block sequence is rewritten.
 */
function regenerateBlockRegion(
  blocks: readonly Block[],
  original: string,
  docRanges: readonly (readonly [string, BlockRange])[],
): string {
  if (docRanges.length === 0) throw new Error('structural edit with no preserved block region — fail closed');
  const throwaway = new IdentityAllocator();
  for (const [id, r] of docRanges) {
    const sliceText = original.slice(r.start, r.end);
    if (!sliceIsFullyCapturedParagraph(sliceText)) {
      throw new Error('structural edit to a document with a non-paragraph or unmodeled block — fail closed');
    }
    // EXACT integrity: the source slice must be byte-identical to parse time. Using the normalized
    // baselineHash here would accept a tampered-but-normalization-equivalent slice.
    if (hashSourceSlice(sliceText) !== r.sourceHash || !blockFromText(sliceText, throwaway)) {
      throw new Error(`preservation range for block ${id} drifted or was tampered — fail closed`);
    }
  }
  if (!blocks.every((b) => b.kind === 'paragraph')) {
    throw new Error('structural edit produced a non-paragraph block — fail closed');
  }
  // The region [regionStart, regionEnd) is replaced wholesale by the regenerated paragraphs,
  // so ANY bytes BETWEEN consecutive block ranges would be dropped. A non-empty gap means the
  // blocks are not contiguous direct siblings — an inter-block comment/PI, a bookmark, or a
  // wrapping element's close tag (e.g. </w:customXml> or an SDT boundary) sits there. Deleting
  // it would corrupt the document or lose content, so fail closed.
  for (let i = 1; i < docRanges.length; i += 1) {
    if (original.slice(docRanges[i - 1][1].end, docRanges[i][1].start).length !== 0) {
      throw new Error('structural edit across non-contiguous blocks (inter-block content would be lost) — fail closed');
    }
  }
  const regionStart = docRanges[0][1].start;
  const regionEnd = docRanges[docRanges.length - 1][1].end;
  const newBody = blocks.map((b) => paragraphXml(b as ParagraphRecord)).join('');
  return original.slice(0, regionStart) + newBody + original.slice(regionEnd);
}

export function emitPreservedPart(model: PackageModel, original: string, ranges: ReadonlyMap<string, BlockRange>): string {
  const bodyStory = model.stories.get(bodyStoryId(model))!;
  const docRanges = [...ranges].filter(([, r]) => r.partName === DOC_PART).sort((a, b) => a[1].start - b[1].start);
  const rangeOrder = docRanges.map(([id]) => id);
  const bodyIds = bodyStory.blocks.map((b) => b.id);
  if (bodyIds.length !== rangeOrder.length || bodyIds.some((id, i) => id !== rangeOrder[i])) {
    // A STRUCTURAL edit (paragraph split/join/insert/delete/reorder): regenerate the whole
    // block region from the current model, keeping everything OUTSIDE it — leading content,
    // the trailing w:sectPr, the body/document shell, and every other package part —
    // verbatim. Guarded to the all-fully-captured-paragraph case so it is lossless.
    return regenerateBlockRegion(bodyStory.blocks, original, docRanges);
  }
  const byId = new Map(bodyStory.blocks.map((b) => [b.id, b] as const));
  const throwaway = new IdentityAllocator();
  const patches: { start: number; end: number; xml: string }[] = [];
  for (const [id, r] of docRanges) {
    const sliceText = original.slice(r.start, r.end);
    const reparsed = blockFromText(sliceText, throwaway);
    // EXACT integrity (byte-identical source slice), independent of the normalized edit-detection
    // hash below — so a tampered slice that normalizes equal is still rejected.
    if (!reparsed || hashSourceSlice(sliceText) !== r.sourceHash) {
      throw new Error(`preservation range for block ${id} does not match its source hash (tampered or drifted snapshot)`);
    }
    const block = byId.get(id)!;
    if (hashPreservableBlock(block) === r.baselineHash) continue; // unchanged -> verbatim
    if (block.kind === 'table' && reparsed.kind === 'table') {
      const cellPatches = patchEditedTable(sliceText, r.start, reparsed, block);
      if (!cellPatches) throw new Error(`table ${id} was edited structurally or in unmodeled content — fail closed`);
      patches.push(...cellPatches);
    } else if (block.kind === 'paragraph' && reparsed.kind === 'paragraph') {
      // An edited TOP-LEVEL paragraph: regenerate it in place ONLY if its ORIGINAL slice
      // was fully captured (so regeneration drops no unmodeled content, comments/PIs
      // included), leaving every other byte — styles, relationships, section properties,
      // sibling blocks — verbatim.
      if (!sliceIsFullyCapturedParagraph(sliceText)) {
        throw new Error(`paragraph ${id} carries unmodeled content — fail closed`);
      }
      patches.push({ start: r.start, end: r.end, xml: paragraphXml(block) });
    } else {
      throw new Error(`preserved block ${id} was edited; only paragraph and cell-paragraph edits regenerate — fail closed`);
    }
  }
  patches.sort((a, b) => b.start - a.start); // highest offset first so earlier offsets stay valid
  let out = original;
  for (const p of patches) out = out.slice(0, p.start) + p.xml + out.slice(p.end);
  return out;
}

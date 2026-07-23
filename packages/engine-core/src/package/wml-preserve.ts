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
function contentForHash(block: Block): unknown {
  if (block.kind === 'paragraph') {
    return { kind: 'paragraph', runs: block.runs, ...(block.props ? { props: block.props } : {}) };
  }
  if (block.kind === 'sdt') {
    return { kind: 'sdt', props: block.props, blocks: block.blocks.map(contentForHash) };
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
export function paragraphFullyCaptured(pEl: Extract<XmlNode, { type: 'element' }>): boolean {
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
export function emitPreservedPart(model: PackageModel, original: string, ranges: ReadonlyMap<string, BlockRange>): string {
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

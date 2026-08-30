// Clipboard fragment extraction: a semantic range becomes a minimal, valid
// WordprocessingML package (rich-clipboard-fidelity tasks 1.2-1.6).
//
// The editing surface computes WHERE (the coverage description below) with the same
// predicate the range-deletion planner uses; this module computes WHAT travels. Only data
// crosses that lane boundary — the store never imports from the editor lane.
//
// The fragment is a real OPC zip readable by `readOoxmlPackage`, so the paste side reuses
// the bounded file-open trust boundary instead of growing a second parser.

import {
  WML_NAMESPACE_URI,
  serializeOoxmlPart,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { resolveContentTypeOf, relationshipsOf } from '../package/package-edit.ts';
import { resolveInternalTarget } from '../package/opc-names.ts';
import type { RelationshipRecord } from '../package/relationships.ts';
import { escapeXmlAttribute } from '../package/sinks.ts';
import { resolveNotesPart } from '../package/note-references.ts';
import { writeZip, strToU8 } from '../package/zip.ts';
import { applyTreeOp } from './tree-op-apply.ts';
import { paragraphLength } from './tree-op-segments.ts';
import { attributeValueOf } from './tree-op-nodes.ts';
import {
  DOCUMENT_CT,
  ENDNOTES_CT,
  ENDNOTES_REL,
  FOOTNOTES_CT,
  FOOTNOTES_REL,
  NUMBERING_CT,
  NUMBERING_REL,
  OFFICE_DOCUMENT_REL,
  RELS_CT,
  STYLES_CT,
  STYLES_REL,
  collectNumIds,
  collectRelationshipIds,
  collectStyleIds,
  documentRootFor,
  freshRelationshipId,
  literalizeThemeReferences,
  mediaExtensionOf,
  noteReferenceClosure,
  numberingClosure,
  relationshipXml,
  styleClosure,
  stylesIndexOf,
  syntheticPart,
  themeFontsOf,
  walkNodes,
} from './clipboard-fragment-closure.ts';

const CT_XMLNS = 'http://schemas.openxmlformats.org/package/2006/content-types';

/** Hard bound on blocks a single fragment may carry; a select-all of a huge doc stays sane. */
const MAX_FRAGMENT_BLOCKS = 50_000;

/**
 * WHERE a copy reaches, computed by the editing surface against the published layout with
 * the same full-coverage predicate `planRangeDeletion` uses. Pure data: paragraph ids in
 * document order, edge offsets in the store's segment offset space, and the coverage sets.
 */
export interface FragmentCoverage {
  /** Story part the range lives in (`/word/document.xml` for the body). */
  readonly partName: string;
  /** Every paragraph the range touches, in document order, edges included. */
  readonly paragraphIds: readonly string[];
  /** Offset into the first paragraph where the range starts. */
  readonly startOffset: number;
  /** Offset into the last paragraph where the range ends. */
  readonly endOffset: number;
  /** Paragraphs the range covers mark-to-mark (the deletion planner's `covered`). */
  readonly coveredParagraphIds: readonly string[];
  /** Outermost tables and block SDTs whose every paragraph is covered. */
  readonly fullyCoveredBlockIds: readonly string[];
  /** True when the range reaches the last paragraph's far edge (its mark travels). */
  readonly lastMarkCovered: boolean;
}

export type FragmentExtractRejection =
  | 'unknown-part'
  | 'empty-range'
  | 'trim-refused'
  | 'resource-limit';

export type FragmentExtractResult =
  | {
      readonly ok: true;
      /** The fragment package zip, readable by `readOoxmlPackage`. */
      readonly bytes: Uint8Array;
      /** Travels beside the zip (HTML attribute): whether the last paragraph mark is covered. */
      readonly lastMarkCovered: boolean;
      readonly blockCount: number;
      /** Total bytes of media carried, for the copy-side degrade tiers. */
      readonly mediaBytes: number;
    }
  | { readonly ok: false; readonly reason: FragmentExtractRejection };

function isElementNode(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function paragraphIdsUnder(node: OoxmlNode, out: string[] = []): string[] {
  if (node.kind === 'textValue') return out;
  if (node.kind === 'paragraph') out.push(node.id);
  for (const child of node.children) paragraphIdsUnder(child, out);
  return out;
}

function findParagraph(node: OoxmlNode, id: string): OoxmlElement | null {
  if (node.kind === 'textValue') return null;
  if (node.kind === 'paragraph' && node.id === id) return node;
  for (const child of node.children) {
    const found = findParagraph(child, id);
    if (found) return found;
  }
  return null;
}

function withChildren(node: OoxmlElement, children: readonly OoxmlNode[]): OoxmlElement {
  return { ...node, children } as OoxmlElement;
}

// Deliberately NOT a type predicate: negating `node is OoxmlElement` would collapse the
// remaining union to `never` in every false branch.
function isWmlElement(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.localName === localName &&
    node.namespaceUri === WML_NAMESPACE_URI
  );
}

// ---------------------------------------------------------------------------
// Block collection
// ---------------------------------------------------------------------------

interface CollectContext {
  readonly inRange: ReadonlySet<string>;
  readonly covered: ReadonlySet<string>;
  readonly fullBlocks: ReadonlySet<string>;
}

/** The story's block container: `w:body` for a document part, the root itself otherwise. */
function storyContainerOf(part: OoxmlPart): OoxmlElement | null {
  if (part.root.kind === 'document') {
    const body = part.root.children.find((child) => child.kind === 'body');
    return body && isElementNode(body) ? body : null;
  }
  return isElementNode(part.root) ? part.root : null;
}

function touchesRange(node: OoxmlNode, inRange: ReadonlySet<string>): boolean {
  return paragraphIdsUnder(node).some((id) => inRange.has(id));
}

/**
 * A `w:vMerge` continuation in the FIRST extracted row becomes a restart, so a row-aligned
 * partial copy that starts inside a vertical merge stays a valid table (review finding 11).
 */
function withVMergeRestarts(row: OoxmlElement): OoxmlElement {
  const restarted = (node: OoxmlNode): OoxmlNode => {
    if (node.kind === 'textValue') return node;
    if (isWmlElement(node, 'vMerge')) {
      if (attributeValueOf(node, 'val') === 'restart') return node;
      const attributes: OoxmlAttribute[] = [
        ...node.attributes.filter(
          (attribute) =>
            !(attribute.localName === 'val' && attribute.namespaceUri === WML_NAMESPACE_URI)
        ),
        {
          kind: 'wmlVal',
          namespaceUri: WML_NAMESPACE_URI,
          localName: 'val',
          prefix: 'w',
          value: 'restart',
        },
      ];
      return { ...node, attributes } as OoxmlNode;
    }
    if (isWmlElement(node, 'tc') || isWmlElement(node, 'tcPr')) {
      const children: OoxmlNode[] = node.children.map(restarted);
      return withChildren(node, children);
    }
    return node;
  };
  const cells: OoxmlNode[] = row.children.map(restarted);
  return withChildren(row, cells);
}

function partialTableBlocks(table: OoxmlElement, ctx: CollectContext, out: OoxmlNode[]): void {
  const rows = table.children.filter(
    (child): child is OoxmlElement => child.kind !== 'textValue' && isWmlElement(child, 'tr')
  );
  const touched = new Set(paragraphIdsUnder(table).filter((id) => ctx.inRange.has(id)));
  if (touched.size === 0) return;
  const coveredRows = rows.filter((row) => {
    const ids = paragraphIdsUnder(row);
    return ids.length > 0 && ids.every((id) => ctx.covered.has(id));
  });
  const coveredRowParagraphs = new Set(coveredRows.flatMap((row) => paragraphIdsUnder(row)));
  const rowAligned =
    coveredRows.length > 0 &&
    touched.size === coveredRowParagraphs.size &&
    [...touched].every((id) => coveredRowParagraphs.has(id));
  if (rowAligned) {
    let first = true;
    const kept: OoxmlNode[] = [];
    for (const child of table.children) {
      if (!isWmlElement(child, 'tr')) {
        kept.push(child);
        continue;
      }
      if (!coveredRows.includes(child)) continue;
      kept.push(first ? withVMergeRestarts(child as OoxmlElement) : child);
      first = false;
    }
    out.push(withChildren(table, kept));
    return;
  }
  // Not a whole run of rows: the covered cell paragraphs flatten to plain paragraphs.
  for (const id of paragraphIdsUnder(table)) {
    if (!ctx.inRange.has(id)) continue;
    const paragraph = findParagraph(table, id);
    if (paragraph) out.push(paragraph);
  }
}

function collectBlocks(
  children: readonly OoxmlNode[],
  ctx: CollectContext,
  out: OoxmlNode[]
): void {
  for (const child of children) {
    if (!isElementNode(child)) continue;
    if (child.kind === 'paragraph') {
      if (ctx.inRange.has(child.id)) out.push(child);
      continue;
    }
    if (ctx.fullBlocks.has(child.id)) {
      out.push(child);
      continue;
    }
    if (child.kind === 'table') {
      partialTableBlocks(child, ctx, out);
      continue;
    }
    if (child.kind === 'contentControl') {
      // A partially covered block SDT unwraps: its covered inner blocks travel bare.
      const content = child.children.find((inner) => inner.kind === 'contentControlContent');
      if (content && isElementNode(content)) collectBlocks(content.children, ctx, out);
      continue;
    }
    // Unknown wrapper: descend so covered content inside it still travels.
    if (touchesRange(child, ctx.inRange)) collectBlocks(child.children, ctx, out);
  }
}

// ---------------------------------------------------------------------------
// Strip + balance passes
// ---------------------------------------------------------------------------

const COMMENT_MARKER_LOCAL_NAMES = new Set(['commentRangeStart', 'commentRangeEnd']);

function isCommentReferenceRun(node: OoxmlNode): boolean {
  return node.kind === 'run' && node.children.some((child) => child.kind === 'commentReference');
}

/**
 * Strip what never travels: comment markers and references, and every `w:sectPr` — the
 * target keeps its own page setup (design D3).
 */
function stripExcluded(node: OoxmlNode): OoxmlNode | null {
  if (node.kind === 'textValue') return node;
  if (COMMENT_MARKER_LOCAL_NAMES.has(node.localName) && node.namespaceUri === WML_NAMESPACE_URI) {
    return null;
  }
  if (isCommentReferenceRun(node)) return null;
  if (isWmlElement(node, 'sectPr')) return null;
  let changed = false;
  const children: OoxmlNode[] = [];
  for (const child of node.children) {
    const kept = stripExcluded(child);
    if (kept === null) {
      changed = true;
      continue;
    }
    if (kept !== child) changed = true;
    children.push(kept);
  }
  return changed ? withChildren(node, children) : node;
}

function fldCharTypeOf(run: OoxmlNode): 'begin' | 'separate' | 'end' | null {
  if (run.kind !== 'run') return null;
  for (const child of run.children) {
    if (child.kind === 'fldChar') {
      const type = attributeValueOf(child, 'fldCharType');
      if (type === 'begin' || type === 'separate' || type === 'end') return type;
      return 'begin';
    }
  }
  return null;
}

function isInstrTextRun(node: OoxmlNode): boolean {
  return node.kind === 'run' && node.children.some((child) => child.kind === 'instrText');
}

/**
 * Keep complex fields balanced ACROSS the whole fragment (review finding 4). A field's
 * `begin` and `end` legally live in different paragraphs — a TOC field spans dozens — so
 * balance is judged over the travelling blocks in document order, not per sibling list.
 * A field cut at either edge drops its machinery (`w:fldChar`, `w:instrText`) and keeps
 * its cached result runs.
 */
function balanceFieldsAcrossBlocks(blocks: readonly OoxmlNode[]): readonly OoxmlNode[] {
  interface FieldRun {
    readonly nodeId: string;
    readonly type: 'begin' | 'separate' | 'end' | 'instr';
  }
  const sequence: FieldRun[] = [];
  const scan = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'run') {
      const type = fldCharTypeOf(node);
      if (type) sequence.push({ nodeId: node.id, type });
      else if (isInstrTextRun(node)) sequence.push({ nodeId: node.id, type: 'instr' });
      return;
    }
    for (const child of node.children) scan(child);
  };
  for (const block of blocks) scan(block);
  if (sequence.length === 0) return blocks;

  const drop = new Set<string>();
  const stack: Array<{ readonly beginId: string; separateId: string | null; instrIds: string[] }> =
    [];
  // Machinery seen at depth zero with no owning `begin` in the fragment — a field whose
  // begin was cut away. Its instructions drop; its result (after the free separate) stays.
  let freeSeparateId: string | null = null;
  let freeInstrIds: string[] = [];

  for (const run of sequence) {
    if (run.type === 'begin') {
      stack.push({ beginId: run.nodeId, separateId: null, instrIds: [] });
      continue;
    }
    if (run.type === 'separate') {
      const top = stack[stack.length - 1];
      if (top) top.separateId = run.nodeId;
      else freeSeparateId = run.nodeId;
      continue;
    }
    if (run.type === 'instr') {
      const top = stack[stack.length - 1];
      if (top) top.instrIds.push(run.nodeId);
      else if (freeSeparateId === null) freeInstrIds.push(run.nodeId);
      continue;
    }
    // end
    const top = stack.pop();
    if (top) continue; // matched — the whole field travels intact
    drop.add(run.nodeId);
    if (freeSeparateId !== null) drop.add(freeSeparateId);
    for (const id of freeInstrIds) drop.add(id);
    freeSeparateId = null;
    freeInstrIds = [];
  }
  // Unclosed begins: drop their machinery; result content after their separate stays.
  for (const open of stack) {
    drop.add(open.beginId);
    if (open.separateId !== null) drop.add(open.separateId);
    for (const id of open.instrIds) drop.add(id);
  }
  if (freeSeparateId !== null) drop.add(freeSeparateId);
  for (const id of freeInstrIds) drop.add(id);
  if (drop.size === 0) return blocks;

  const rebuild = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return node;
    if (drop.has(node.id)) return null;
    const children: OoxmlNode[] = [];
    let changed = false;
    for (const child of node.children) {
      const kept = rebuild(child);
      if (kept === null) {
        changed = true;
        continue;
      }
      if (kept !== child) changed = true;
      children.push(kept);
    }
    return changed ? withChildren(node, children) : node;
  };
  return blocks
    .map((block) => rebuild(block))
    .filter((block): block is OoxmlNode => block !== null);
}

/** Sum of addressable-ish text under a node — enough to detect an SDT the trim emptied. */
function textishLength(node: OoxmlNode): number {
  if (node.kind === 'textValue') return node.value.length;
  let total = 0;
  for (const child of node.children) total += textishLength(child);
  return total;
}

/**
 * Inline-SDT edge rule (review finding 7): a control the trim emptied disappears; one the
 * trim shrank unwraps to its covered runs. Fully covered controls are untouched.
 */
function resolveEdgeInlineSdts(
  paragraph: OoxmlElement,
  preTrimLengths: ReadonlyMap<string, number>
): OoxmlElement {
  const resolved: OoxmlNode[] = [];
  for (const child of paragraph.children) {
    if (child.kind !== 'contentControl') {
      resolved.push(child);
      continue;
    }
    const before = preTrimLengths.get(child.id);
    const after = textishLength(child);
    if (before === undefined || after >= before) {
      resolved.push(child);
      continue;
    }
    if (after === 0) continue;
    const content = child.children.find((inner) => inner.kind === 'contentControlContent');
    if (content && isElementNode(content)) resolved.push(...content.children);
    else resolved.push(child);
  }
  return withChildren(paragraph, resolved);
}

/** Drop bookmark markers whose partner did not travel (unbalanced starts and ends). */
function balanceBookmarks(blocks: readonly OoxmlNode[]): readonly OoxmlNode[] {
  const startIds = new Set<string>();
  const endIds = new Set<string>();
  const scan = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'bookmarkStart') {
      const id = attributeValueOf(node, 'id');
      if (id !== undefined) startIds.add(id);
    }
    if (node.kind === 'bookmarkEnd') {
      const id = attributeValueOf(node, 'id');
      if (id !== undefined) endIds.add(id);
    }
    for (const child of node.children) scan(child);
  };
  for (const block of blocks) scan(block);

  const balanced = new Set([...startIds].filter((id) => endIds.has(id)));
  if (balanced.size === startIds.size && balanced.size === endIds.size) return blocks;

  const drop = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return node;
    if (node.kind === 'bookmarkStart' || node.kind === 'bookmarkEnd') {
      const id = attributeValueOf(node, 'id');
      return id !== undefined && balanced.has(id) ? node : null;
    }
    const children: OoxmlNode[] = [];
    let changed = false;
    for (const child of node.children) {
      const kept = drop(child);
      if (kept === null) {
        changed = true;
        continue;
      }
      if (kept !== child) changed = true;
      children.push(kept);
    }
    return changed ? withChildren(node, children) : node;
  };
  return blocks.map((block) => drop(block) ?? block);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Extract the covered range into a fragment package zip.
 *
 * Pure over its inputs: the package and the coverage description. The blocks travel with
 * their dependency closure (styles, numbering, media, hyperlink rels, referenced note
 * bodies) and without headers/footers, `w:sectPr`, comments, settings, docDefaults (beyond
 * the materialized copy in the fragment styles part), or theme.
 */
export function extractFragmentPackage(
  pkg: OoxmlPackage,
  coverage: FragmentCoverage,
  options?: {
    /** Copy-side degrade tier 1: leave media behind; their drawings degrade away. */
    readonly omitMedia?: boolean;
  }
): FragmentExtractResult {
  const sourcePart = pkg.parts.get(coverage.partName);
  if (!sourcePart) return { ok: false, reason: 'unknown-part' };
  if (coverage.paragraphIds.length === 0) return { ok: false, reason: 'empty-range' };

  const firstId = coverage.paragraphIds[0]!;
  const lastId = coverage.paragraphIds[coverage.paragraphIds.length - 1]!;

  // Pre-trim inline-SDT lengths on the edge paragraphs, for the shrink/empty rule.
  const preTrimSdtLengths = new Map<string, number>();
  for (const id of [firstId, lastId]) {
    const paragraph = findParagraph(sourcePart.root, id);
    if (!paragraph) return { ok: false, reason: 'empty-range' };
    for (const child of paragraph.children) {
      if (child.kind === 'contentControl') preTrimSdtLengths.set(child.id, textishLength(child));
    }
  }

  // Trim the edges through the ordinary op machinery, so runs split, wrappers divide and
  // atoms hold exactly as they do for every other range gesture.
  // `deferValidation`: the trimmed part is only serialized into the fragment zip, and the
  // paste side re-validates through `readOoxmlPackage` + `validateInsertFragment` + commit.
  // A full-part revalidation per trim made every copy O(document), the copy floor for a
  // small drag in a large doc.
  let part = sourcePart;
  const lastParagraph = findParagraph(part.root, lastId);
  if (!lastParagraph) return { ok: false, reason: 'empty-range' };
  const lastLength = paragraphLength(lastParagraph as never);
  if (coverage.endOffset < lastLength) {
    const trimmed = applyTreeOp(
      part,
      { op: 'deleteText', paragraphId: lastId, start: coverage.endOffset, end: lastLength },
      { deferValidation: true }
    );
    if (!trimmed.ok) return { ok: false, reason: 'trim-refused' };
    part = trimmed.part;
  }
  if (coverage.startOffset > 0) {
    const trimmed = applyTreeOp(
      part,
      { op: 'deleteText', paragraphId: firstId, start: 0, end: coverage.startOffset },
      { deferValidation: true }
    );
    if (!trimmed.ok) return { ok: false, reason: 'trim-refused' };
    part = trimmed.part;
  }

  const container = storyContainerOf(part);
  if (!container) return { ok: false, reason: 'unknown-part' };

  const ctx: CollectContext = {
    inRange: new Set(coverage.paragraphIds),
    covered: new Set(coverage.coveredParagraphIds),
    fullBlocks: new Set(coverage.fullyCoveredBlockIds),
  };
  const rawBlocks: OoxmlNode[] = [];
  collectBlocks(container.children, ctx, rawBlocks);
  if (rawBlocks.length === 0) return { ok: false, reason: 'empty-range' };
  if (rawBlocks.length > MAX_FRAGMENT_BLOCKS) return { ok: false, reason: 'resource-limit' };

  // Strip, resolve edge SDTs, balance fields and bookmarks.
  let blocks = rawBlocks
    .map((block) => stripExcluded(block))
    .filter((block): block is OoxmlNode => block !== null)
    .map((block) => {
      if (block.kind !== 'paragraph') return block;
      if (block.id !== firstId && block.id !== lastId) return block;
      return resolveEdgeInlineSdts(block, preTrimSdtLengths);
    });
  blocks = [...balanceFieldsAcrossBlocks(blocks)];
  blocks = [...balanceBookmarks(blocks)];

  // Referenced note bodies travel; their styles and rels join the closure. The set
  // is TRANSITIVE over note bodies — the SAME closure the merge scrubs against, so
  // the ship set and the scrub set cannot drift.
  let footnotesPart = resolveNotesPart(pkg, 'footnote');
  let endnotesPart = resolveNotesPart(pkg, 'endnote');
  const noteBodyOf = (kind: 'footnote' | 'endnote', id: string): OoxmlNode | null => {
    const part = kind === 'footnote' ? footnotesPart : endnotesPart;
    if (!part || !isElementNode(part.root)) return null;
    for (const child of part.root.children) {
      if (isElementNode(child) && child.kind === 'note' && attributeValueOf(child, 'id') === id) {
        return child;
      }
    }
    return null;
  };
  const referencedNotes = noteReferenceClosure(blocks, noteBodyOf);
  const footnoteIds = referencedNotes.footnote;
  const endnoteIds = referencedNotes.endnote;
  // A kind with no ids ships no part (separators included).
  if (footnoteIds.size === 0) footnotesPart = null;
  if (endnoteIds.size === 0) endnotesPart = null;

  const includedNotes = (notesPart: OoxmlPart | null, ids: ReadonlySet<string>): OoxmlElement[] => {
    if (!notesPart || !isElementNode(notesPart.root)) return [];
    const notes: OoxmlElement[] = [];
    for (const child of notesPart.root.children) {
      if (!isElementNode(child) || child.kind !== 'note') continue;
      const id = attributeValueOf(child, 'id');
      const type = attributeValueOf(child, 'type');
      if (type === 'separator' || type === 'continuationSeparator') {
        notes.push(child);
        continue;
      }
      if (id !== undefined && ids.has(id)) {
        const stripped = stripExcluded(child);
        if (stripped && isElementNode(stripped)) notes.push(stripped);
      }
    }
    return notes;
  };
  const footnotes = includedNotes(footnotesPart, footnoteIds);
  const endnotes = includedNotes(endnotesPart, endnoteIds);
  const noteBodies: OoxmlNode[] = [...footnotes, ...endnotes];

  // Closure inputs: blocks plus note bodies.
  const closureNodes: OoxmlNode[] = [...blocks, ...noteBodies];
  const styleIds = new Set<string>();
  collectStyleIds(closureNodes, styleIds);
  const stylesIndex = stylesIndexOf(pkg, pkg.mainDocumentPart);
  const styles = styleClosure(stylesIndex, styleIds);

  const numIds = new Set<string>();
  collectNumIds(closureNodes, numIds);
  collectNumIds(styles, numIds);
  const numbering = numberingClosure(pkg, pkg.mainDocumentPart, numIds);
  // Numbering styles referenced from the numbering closure travel too.
  const numberingStyleIds = new Set<string>();
  collectStyleIds([...numbering.nums, ...numbering.abstracts], numberingStyleIds);
  for (const node of [...numbering.nums, ...numbering.abstracts]) {
    walkNodes(node, (current) => {
      if (current.kind === 'textValue') return;
      if (
        (current.localName === 'styleLink' || current.localName === 'numStyleLink') &&
        current.namespaceUri === WML_NAMESPACE_URI
      ) {
        const value = attributeValueOf(current, 'val');
        if (value) numberingStyleIds.add(value);
      }
    });
  }
  const extraStyles = styleClosure(stylesIndex, numberingStyleIds).filter(
    (style) => !styles.includes(style)
  );
  const allStyles = [...styles, ...extraStyles];

  // Theme literalization for everything the fragment ships.
  const fonts = themeFontsOf(pkg, pkg.mainDocumentPart);
  const literalStyles = allStyles.map(
    (style) => literalizeThemeReferences(style, fonts) as OoxmlElement
  );
  const literalDocDefaults = stylesIndex.docDefaults
    ? (literalizeThemeReferences(stylesIndex.docDefaults, fonts) as OoxmlElement)
    : null;
  blocks = blocks.map((block) => literalizeThemeReferences(block, fonts));
  const literalFootnotes = footnotes.map(
    (note) => literalizeThemeReferences(note, fonts) as OoxmlElement
  );
  const literalEndnotes = endnotes.map(
    (note) => literalizeThemeReferences(note, fonts) as OoxmlElement
  );

  // Relationship subsets, per owner story.
  const usedDocRels = new Set<string>();
  collectRelationshipIds(blocks, usedDocRels);
  const docRecords = relationshipsOf(pkg, sourcePart.name).filter((record) =>
    usedDocRels.has(record.id)
  );

  // Media: internal image targets travel byte-identical under their ORIGINAL names, so no
  // target rewriting is needed. A drawing pointing at a non-media internal part (a chart,
  // an embedded object) is dropped rather than shipped dangling (review finding 13).
  // Droppable rel ids are tracked PER OWNER PART: rel-id namespaces are per part, and a
  // shared set let a dropped document rel id filter a valid footnote rel out of the zip.
  const mediaEntries = new Map<string, Uint8Array>();
  let mediaBytes = 0;
  const resolveMedia = (records: readonly RelationshipRecord[]): Set<string> => {
    const droppable = new Set<string>();
    for (const record of records) {
      if (record.targetMode === 'External') continue;
      const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
      if (!resolved.ok) {
        droppable.add(record.id);
        continue;
      }
      const contentType = resolveContentTypeOf(pkg, resolved.partName) ?? '';
      if (contentType.toLowerCase().startsWith('image/') && options?.omitMedia !== true) {
        const bytes =
          pkg.partBytes.get(resolved.partName) ??
          pkg.partBytes.get(resolved.partName.replace(/^\//, ''));
        if (bytes) {
          mediaEntries.set(resolved.partName, bytes);
          mediaBytes += bytes.byteLength;
        } else {
          droppable.add(record.id);
        }
        continue;
      }
      // Styles/numbering/notes/theme rels are re-authored below; anything else internal
      // (chart parts, embedded objects) cannot travel whole and its drawing degrades.
      droppable.add(record.id);
    }
    return droppable;
  };
  const docDroppable = resolveMedia(docRecords);

  const dropDanglingDrawings = (
    node: OoxmlNode,
    droppable: ReadonlySet<string>
  ): OoxmlNode | null => {
    if (node.kind === 'textValue') return node;
    if (node.kind === 'drawing') {
      const ids = new Set<string>();
      collectRelationshipIds([node], ids);
      for (const id of ids) if (droppable.has(id)) return null;
      return node;
    }
    const children: OoxmlNode[] = [];
    let changed = false;
    for (const child of node.children) {
      const kept = dropDanglingDrawings(child, droppable);
      if (kept === null) {
        changed = true;
        continue;
      }
      if (kept !== child) changed = true;
      children.push(kept);
    }
    return changed ? withChildren(node, children) : node;
  };
  if (docDroppable.size > 0) {
    blocks = blocks
      .map((block) => dropDanglingDrawings(block, docDroppable))
      .filter((block): block is OoxmlNode => block !== null);
  }
  const keptDocRecords = docRecords.filter((record) => !docDroppable.has(record.id));

  // Note-part rels (images/links inside note bodies), each with its own droppable set —
  // and the same dangling-drawing pass over the BODIES the blocks get.
  const noteRelRecords = (
    notesPart: OoxmlPart | null,
    notes: OoxmlElement[]
  ): RelationshipRecord[] => {
    if (!notesPart) return [];
    const used = new Set<string>();
    collectRelationshipIds(notes, used);
    const records = relationshipsOf(pkg, notesPart.name).filter((record) => used.has(record.id));
    const droppable = resolveMedia(records);
    if (droppable.size > 0) {
      for (let index = 0; index < notes.length; index += 1) {
        const kept = dropDanglingDrawings(notes[index]!, droppable);
        if (kept !== null) notes[index] = kept as OoxmlElement;
      }
    }
    return records.filter((record) => !droppable.has(record.id));
  };
  const footnoteRels = noteRelRecords(footnotesPart, literalFootnotes);
  const endnoteRels = noteRelRecords(endnotesPart, literalEndnotes);

  // ------------------------------------------------------------------
  // Assemble the zip.
  // ------------------------------------------------------------------
  const entries = new Map<string, Uint8Array>();
  const overrides: Array<readonly [string, string]> = [];

  const addXmlPart = (name: string, contentType: string, root: OoxmlElement): void => {
    entries.set(name.slice(1), strToU8(serializeOoxmlPart(syntheticPart(name, contentType, root))));
    overrides.push([name, contentType]);
  };

  // Fragment document rels: the used source subset plus the parts this fragment authors.
  const fragmentDocRels: RelationshipRecord[] = [...keptDocRecords];
  const usedIds = new Set(fragmentDocRels.map((record) => record.id));
  let relHint = 9001;
  const addFragmentRel = (type: string, target: string): void => {
    const id = freshRelationshipId(usedIds, relHint);
    relHint += 1;
    usedIds.add(id);
    fragmentDocRels.push({
      ownerPart: '/word/document.xml',
      id,
      type,
      rawTarget: target,
      targetMode: 'Internal',
      order: fragmentDocRels.length,
    });
  };

  // document.xml
  const documentRoot = documentRootFor(part, blocks);
  addXmlPart('/word/document.xml', DOCUMENT_CT, documentRoot);

  // styles.xml — the closure plus materialized (theme-literal) docDefaults.
  if (stylesIndex.part && (literalStyles.length > 0 || literalDocDefaults)) {
    const stylesRoot = withChildren(stylesIndex.part.root as OoxmlElement, [
      ...(literalDocDefaults ? [literalDocDefaults] : []),
      ...literalStyles,
    ]);
    addXmlPart('/word/styles.xml', STYLES_CT, stylesRoot);
    addFragmentRel(STYLES_REL, 'styles.xml');
  }

  // numbering.xml
  if (numbering.part && (numbering.nums.length > 0 || numbering.abstracts.length > 0)) {
    const numberingRoot = withChildren(numbering.part.root as OoxmlElement, [
      ...numbering.abstracts.map((node) => literalizeThemeReferences(node, fonts) as OoxmlElement),
      ...numbering.nums,
    ]);
    addXmlPart('/word/numbering.xml', NUMBERING_CT, numberingRoot);
    addFragmentRel(NUMBERING_REL, 'numbering.xml');
  }

  // notes parts
  if (footnotesPart && literalFootnotes.length > 0) {
    addXmlPart(
      '/word/footnotes.xml',
      FOOTNOTES_CT,
      withChildren(footnotesPart.root as OoxmlElement, literalFootnotes)
    );
    addFragmentRel(FOOTNOTES_REL, 'footnotes.xml');
    if (footnoteRels.length > 0) {
      entries.set('word/_rels/footnotes.xml.rels', strToU8(relationshipXml(footnoteRels)));
    }
  }
  if (endnotesPart && literalEndnotes.length > 0) {
    addXmlPart(
      '/word/endnotes.xml',
      ENDNOTES_CT,
      withChildren(endnotesPart.root as OoxmlElement, literalEndnotes)
    );
    addFragmentRel(ENDNOTES_REL, 'endnotes.xml');
    if (endnoteRels.length > 0) {
      entries.set('word/_rels/endnotes.xml.rels', strToU8(relationshipXml(endnoteRels)));
    }
  }

  // media
  const mediaExtensions = new Map<string, string>();
  for (const [name, bytes] of mediaEntries) {
    entries.set(name.slice(1), bytes);
    const ext = mediaExtensionOf(name);
    if (ext && !mediaExtensions.has(ext)) {
      mediaExtensions.set(ext, resolveContentTypeOf(pkg, name) ?? 'application/octet-stream');
    }
  }

  // rels
  entries.set('word/_rels/document.xml.rels', strToU8(relationshipXml(fragmentDocRels)));
  entries.set(
    '_rels/.rels',
    strToU8(
      relationshipXml([
        {
          ownerPart: '/',
          id: 'rId1',
          type: OFFICE_DOCUMENT_REL,
          rawTarget: 'word/document.xml',
          targetMode: 'Internal',
          order: 0,
        },
      ])
    )
  );

  // [Content_Types].xml
  const defaults = [
    `<Default Extension="rels" ContentType="${RELS_CT}"/>`,
    '<Default Extension="xml" ContentType="application/xml"/>',
    ...[...mediaExtensions].map(
      ([ext, type]) =>
        `<Default Extension="${escapeXmlAttribute(ext)}" ContentType="${escapeXmlAttribute(type)}"/>`
    ),
  ].join('');
  const overrideRows = overrides
    .map(
      ([name, type]) =>
        `<Override PartName="${escapeXmlAttribute(name)}" ContentType="${escapeXmlAttribute(type)}"/>`
    )
    .join('');
  entries.set(
    '[Content_Types].xml',
    strToU8(`<Types xmlns="${CT_XMLNS}">${defaults}${overrideRows}</Types>`)
  );

  return {
    ok: true,
    bytes: writeZip(entries),
    lastMarkCovered: coverage.lastMarkCovered,
    blockCount: blocks.length,
    mediaBytes,
  };
}

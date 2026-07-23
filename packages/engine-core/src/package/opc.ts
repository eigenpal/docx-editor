// Minimal OPC package reader/writer (document-engine tasks 2.7 partial, 3.6, 3.7).
// parseDocx: DOCX bytes -> authored PackageModel (body story paragraphs/runs +
// content types + root relationship). writeDocx: PackageModel -> valid minimal
// DOCX bytes. Attacker-derived text is XML-escaped on write; the reader goes
// through the bounded ZIP + XML trust boundary. This is the parse<->serialize
// round-trip that gate 5 (parse->edit->save->reopen) exercises.

import { readZip, writeZip, strToU8, strFromU8, type ZipRejection } from './zip.ts';
import { readXml, findElement, childElements } from './xml-reader.ts';
import { scanBodyBlockSpans, ScanError, type BlockSpan } from './wml-scan.ts';
import { blockXml } from './wml-serialize.ts';
import {
  W_NS, collectParagraphElements, paragraphFromElement, blockFromSpan,
  treeHasTable, treeHasBlockSdt, deepHasTable, deepCountTables, countModelTables,
  hasNonWWordBinding, countTreeBlocks,
} from './wml-parse.ts';
import { relatedStoryParts, parseStoryParagraphs, parseStyles, parseNumbering } from './wml-parts.ts';
import { DOC_PART, hashPreservableBlock, emitPreservedPart } from './wml-preserve.ts';
import {
  createEmptyModel,
  bodyStoryId,
  type PackageModel,
  type Story,
  type Block,
  type ParagraphRecord,
  type BlockRange,
  type PreservationState,
  validatePreservation,
} from '../model/index.ts';
import { IdentityAllocator } from '../model/identity.ts';


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
  // Tables AND block-level content controls (w:sdt) activate the structural span-driven
  // preservation path so neither is flattened; everything else takes the flat paragraph
  // parse. Verbatim re-emit keeps an unedited document byte-identical.
  const wantsPreservation =
    (body ? treeHasTable(body) || treeHasBlockSdt(body) : false) ||
    (spans?.some((s) => s.name === 'w:tbl' || s.name === 'w:sdt') ?? false);
  // Safety net: a table exists somewhere but the block traversals (which descend only
  // through known wrappers w:sdt/w:customXml) did not reach it — fail closed rather
  // than silently drop it on the flat path.
  if (body && !wantsPreservation && deepHasTable(body)) {
    return { ok: false, reason: 'xml-error', detail: 'table in an unsupported container (fail closed)' };
  }
  const blocks: Block[] = [];
  let preservation: PreservationState | undefined;
  if (wantsPreservation) {
    // A preserved (table / content-control) document MUST scan cleanly and its spans
    // MUST match the parsed tree's top-level blocks exactly, or ranges could mis-own
    // content (guards decoy tags in comments, malformed nesting, and the reader's
    // non-strict well-formedness). Any failure rejects the document rather than falling
    // back to a lossy flat parse.
    if (!spans || !body) return { ok: false, reason: 'xml-error', detail: 'preserved document failed strict span scan' };
    const blockRanges = new Map<string, BlockRange>();
    for (const span of spans) {
      const block = blockFromSpan(docText, span, alloc);
      if (!block) return { ok: false, reason: 'xml-error', detail: 'preservation fragment parse failed' };
      blocks.push(block);
      blockRanges.set(block.id, { partName: DOC_PART, start: span.start, end: span.end, baselineHash: hashPreservableBlock(block) });
    }
    if (blocks.length !== spans.length || countTreeBlocks(body) !== blocks.length) {
      return { ok: false, reason: 'xml-error', detail: 'preservation scan/tree mismatch' };
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

// DOCX package READER (document-engine): DOCX bytes -> authored PackageModel through the
// bounded ZIP + XML trust boundary, plus isPlainEditableDocx (the lossless-editability
// gate). WordprocessingML element parsing lives in wml-parse/wml-parts, preservation in
// wml-preserve, and serialization in ./write.

import { readZip, strFromU8, type ZipRejection } from '../zip.ts';
import { resolveCoreRegistry } from '../../capabilities/index.ts';
import { readXml, findElement, childElements, type XmlNode } from '../xml-reader.ts';
import { scanBodyBlockSpans, ScanError, type BlockSpan } from '../wml-scan.ts';
import {
  el, collectParagraphElements, paragraphFromElement, blockFromSpan,
  treeHasTable, treeHasBlockSdt, deepHasTable, deepHasBlockSdt, deepCountTables,
  countModelTables, hasNonWWordBinding, countTreeBlocks,
} from '../wml-parse.ts';
import { relatedStoryParts, parseStoryParagraphs, parseStyles, parseDocDefaults, parseNumbering } from '../wml-parts.ts';
import {
  DOC_PART,
  hashPreservableBlock,
  hashSourceSlice,
  paragraphFullyCaptured,
  sliceIsFullyCapturedParagraph,
} from '../wml-preserve.ts';
import { extractParagraphPropertiesCapsule, extractParagraphOpenAttributes } from '../preservation-capsule.ts';
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
  isTopLevelEditable,
} from '../../model/index.ts';
import { IdentityAllocator } from '../../model/identity.ts';

export type DocxParseRejection = ZipRejection | 'no-document' | 'xml-error';

export type ParseResult =
  | { readonly ok: true; readonly model: PackageModel }
  | { readonly ok: false; readonly reason: DocxParseRejection; readonly detail?: string };

export interface ParseOptions {
  /** Force the verbatim structural-preservation path even for a table-free document, so
   *  every part and every unedited byte round-trips losslessly (used to open ordinary
   *  documents — styles/relationships/section properties — for editing). */
  readonly preserveAll?: boolean;
}

export function parseDocx(bytes: Uint8Array, options: ParseOptions = {}): ParseResult {
  // Document open: connect the versioned FeatureBundle registry to the registered runtime handlers
  // and reject a half-registered editable capability BEFORE any content is parsed (memoized).
  resolveCoreRegistry();
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
    options.preserveAll ||
    (body ? treeHasTable(body) || treeHasBlockSdt(body) : false) ||
    (spans?.some((s) => s.name === 'w:tbl' || s.name === 'w:sdt') ?? false);
  // Safety net: a table OR a block-level content control exists somewhere the structural
  // block traversals (which descend only through the known wrappers w:sdt/w:customXml)
  // did not reach — e.g. hidden inside w:ins / mc:AlternateContent / an unknown foreign
  // element. On the flat path nothing is preserved, so silently dropping it would lose
  // content; fail closed instead.
  if (body && !wantsPreservation && deepHasTable(body)) {
    return { ok: false, reason: 'xml-error', detail: 'table in an unsupported container (fail closed)' };
  }
  if (body && !wantsPreservation && deepHasBlockSdt(body)) {
    return { ok: false, reason: 'xml-error', detail: 'block content control in an unsupported container (fail closed)' };
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
      let block = blockFromSpan(docText, span, alloc);
      if (!block) return { ok: false, reason: 'xml-error', detail: 'preservation fragment parse failed' };
      // Capture the paragraph's leading w:pPr as an ownership-scoped capsule (byte-exact from the
      // source slice), so a paragraph carrying unmodeled properties can stay editable and re-splice
      // them verbatim (document-engine 3.2). The baseline hash is then computed WITH the capsule.
      if (block.kind === 'paragraph') {
        const slice = docText.slice(span.start, span.end);
        const pPr = extractParagraphPropertiesCapsule(slice);
        const attrs = extractParagraphOpenAttributes(slice);
        if (pPr) block = { ...block, pPrCapsule: pPr };
        if (attrs) block = { ...block, pAttrsCapsule: attrs }; // only when non-empty
      }
      blocks.push(block);
      blockRanges.set(block.id, {
        partName: DOC_PART,
        start: span.start,
        end: span.end,
        baselineHash: hashPreservableBlock(block),
        sourceHash: hashSourceSlice(docText.slice(span.start, span.end)),
      });
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
  const docDefaults = parseDocDefaults(zip.entries);
  const numbering = parseNumbering(zip.entries);
  const model: PackageModel = {
    ...base,
    stories,
    styles: styles.length > 0 ? styles : base.styles,
    ...(docDefaults ? { docDefaults } : {}),
    numbering,
    identity: alloc.state(),
    ...(preservation ? { preservation } : {}),
  };
  validatePreservation(model); // integer/in-bounds/exists/non-overlapping
  return { ok: true, model };
}

type XmlElement = Extract<XmlNode, { type: 'element' }>;

// The exact content types writeDocx re-emits — a present value that differs would be
// rewritten (lossy), so the gate requires these precisely.
const CT_RELS = 'application/vnd.openxmlformats-package.relationships+xml';
const CT_XML = 'application/xml';
const CT_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

/** Whether [Content_Types].xml is exactly what writeDocx re-emits: only the two package
 *  Defaults (rels, xml) and the single main-document Override, each with its standard
 *  ContentType. Any extra/renamed Default or Override, or a differing content-type value,
 *  would be dropped or rewritten on save. */
function isStandardContentTypes(data: Uint8Array): boolean {
  const rx = readXml(strFromU8(data));
  if (!rx.ok) return false;
  const types = rx.nodes.find((n): n is XmlElement => el(n) && n.name === 'Types');
  if (!types) return false;
  for (const c of types.children) {
    if (!el(c)) continue;
    if (c.name === 'Default') {
      const ext = (c.attributes['Extension'] ?? '').toLowerCase();
      const ct = c.attributes['ContentType'] ?? '';
      if (ext === 'rels') { if (ct !== CT_RELS) return false; }
      else if (ext === 'xml') { if (ct !== CT_XML) return false; }
      else return false;
    } else if (c.name === 'Override') {
      if (c.attributes['PartName'] !== '/word/document.xml' || c.attributes['ContentType'] !== CT_MAIN) return false;
    } else return false;
  }
  return true;
}

/** Whether a relationships part is EMPTY of relationships (its root has no element child).
 *  A present document rels writeDocx does not re-emit, so anything in it would be dropped. */
function relsEmpty(data: Uint8Array): boolean {
  const rx = readXml(strFromU8(data));
  if (!rx.ok) return false;
  const root = rx.nodes.find((n): n is XmlElement => el(n) && n.name === 'Relationships');
  if (!root) return rx.nodes.every((n) => !el(n)); // no Relationships root and no stray elements
  return root.children.every((c) => !el(c));
}

/** Whether a relationships part contains ONLY internal relationships targeting
 *  `word/document.xml` (what the root rels holds and writeDocx re-emits). Any other target
 *  or an external relationship implies a part/link writeDocx does not reproduce. */
function relsTargetOnly(data: Uint8Array, target: string): boolean {
  const rx = readXml(strFromU8(data));
  if (!rx.ok) return false;
  let seen = 0;
  const walk = (nodes: readonly XmlNode[]): boolean =>
    nodes.every((n) => {
      if (!el(n)) return true;
      if (n.name === 'Relationship') {
        seen += 1;
        if (n.attributes['TargetMode'] === 'External') return false;
        return (n.attributes['Target'] ?? '') === target;
      }
      return walk(n.children);
    });
  return walk(rx.nodes) && seen >= 1;
}

/** Whether an element has only namespace-declaration attributes (xmlns / xmlns:*). Any
 *  other attribute (mc:Ignorable, w:conformance, a body attribute, ...) is not reproduced
 *  by the minimal writer. */
function onlyNamespaceAttrs(e: XmlElement): boolean {
  return Object.keys(e.attributes).every((k) => k === 'xmlns' || k.startsWith('xmlns:'));
}

/**
 * Whether a DOCX is a PLAIN, losslessly-editable document — one the minimal writer
 * reproduces EXACTLY. It must hold only the parts writeDocx emits (a standard
 * [Content_Types].xml, a root rels that targets only word/document.xml, word/document.xml,
 * and an empty document rels), its w:document/w:body shell must carry only namespace
 * attributes and no child other than the single w:body, and the body must be nothing but
 * fully-captured paragraphs. Anything writeDocx would DROP or FLATTEN on save — an extra
 * part/relationship/content-type, a document/body attribute, a w:background/second body,
 * section properties, a table or SDT, or a paragraph with a hyperlink/field/tab/break/pPr/
 * unmodeled rPr — makes it read-only, so an edit-and-save can never silently lose content.
 * Conservative by design: a false negative is only a missed edit; a false positive drops data.
 */
export function isPlainEditableDocx(bytes: Uint8Array): boolean {
  const zip = readZip(bytes);
  if (!zip.ok) return false;
  let docXml: Uint8Array | undefined;
  let contentTypes: Uint8Array | undefined;
  let rootRels: Uint8Array | undefined;
  let docRels: Uint8Array | undefined;
  for (const [name, data] of zip.entries) {
    const n = name.toLowerCase();
    if (n === '/word/document.xml') docXml = data;
    else if (n === '/[content_types].xml') contentTypes = data;
    else if (n === '/_rels/.rels') rootRels = data;
    else if (n === '/word/_rels/document.xml.rels') docRels = data;
    else return false; // any other part (styles/numbering/header/footer/media/...) is lost on save
  }
  if (!docXml) return false;
  // A missing content-types / root rels is not lossy — the writer supplies the standard
  // one. Present but non-standard IS lossy (it would be replaced), so validate it.
  if (contentTypes && !isStandardContentTypes(contentTypes)) return false;
  if (rootRels && !relsTargetOnly(rootRels, 'word/document.xml')) return false;
  if (docRels && !relsEmpty(docRels)) return false; // any doc-rel payload is dropped on save
  const xml = readXml(strFromU8(docXml));
  if (!xml.ok) return false;
  // The shell must be exactly <w:document><w:body>…</w:body></w:document> with only
  // namespace attributes: writeDocx emits only that. Reject any additional top-level
  // element (a second root / stray content the reader tolerates).
  const roots = xml.nodes.filter(el);
  if (roots.length !== 1 || roots[0].name !== 'w:document') return false;
  const doc = roots[0];
  if (!onlyNamespaceAttrs(doc)) return false;
  const docChildren = doc.children.filter(el);
  if (docChildren.length !== 1 || docChildren[0].name !== 'w:body' || !onlyNamespaceAttrs(docChildren[0])) return false;
  const body = docChildren[0];
  let sawParagraph = false;
  for (const child of body.children) {
    if (!el(child)) continue;
    if (child.name !== 'w:p') return false; // w:tbl / w:sdt / w:sectPr / anything else
    if (!paragraphFullyCaptured(child)) return false; // hyperlink/field/tab/break/pPr/unmodeled rPr
    sawParagraph = true;
  }
  return sawParagraph;
}

/**
 * Whether a model parsed with `preserveAll` is SELECTIVELY editable: its body is nothing
 * but paragraphs whose original source slice is fully captured, so an edit to any of them
 * regenerates losslessly while every other byte of the package — styles, relationships,
 * section properties, media, sibling parts — is re-emitted verbatim from the preservation
 * snapshot. Unlike isPlainEditableDocx, this ALLOWS a document to carry arbitrary
 * unmodeled parts and shell, because they survive untouched. A table/SDT body block (not a
 * top-level paragraph) or a paragraph with unmodeled content makes the document read-only.
 */
export function isModelBodyPatchable(model: PackageModel): boolean {
  return diagnoseBodyPatchability(model).editable;
}

/** The OOXML root element a block kind serializes to — for the read-only diagnostic's QName. */
const BLOCK_QNAME: Readonly<Record<string, string>> = { paragraph: 'w:p', table: 'w:tbl', sdt: 'w:sdt' };

/** Why a document opens read-only (comprehensive 4.9). Names the blocking capability, the QName +
 *  context, the story, and the missing pipeline lane, so a host can tell a user exactly what to fix
 *  rather than an opaque "read-only". `story` is the story id the block lives in. */
export interface ReadOnlyDiagnostic {
  readonly code:
    | 'no-preservation' // parsed without preserveAll, or an unpreservable package
    | 'no-document-part'
    | 'empty-body'
    | 'non-editable-kind' // a table/SDT (or other non-paragraph) body block
    | 'no-source-range' // a synthetic block with no captured source (e.g. empty-body paragraph)
    | 'unmodeled-content' // a paragraph carrying OOXML the model does not capture (needs capsules)
    | 'non-contiguous-blocks'; // bytes between sibling blocks would be lost on a structural edit
  readonly message: string;
  readonly story: string;
  /** The block that blocks editing, when a specific one is the cause. */
  readonly blockId?: string;
  readonly blockKind?: string;
  readonly qname?: string;
  /** The pipeline lane the document lacks for editing. */
  readonly missingLane: 'preservation' | 'editable-capability' | 'source-range' | 'lossless-capture' | 'contiguity';
}

export type BodyPatchability = { readonly editable: true } | { readonly editable: false; readonly diagnostic: ReadOnlyDiagnostic };

/** Decide whether the body is selectively editable AND, when not, WHY — the structured read-only
 *  diagnostic (4.9). `isModelBodyPatchable` is the boolean projection of this. */
export function diagnoseBodyPatchability(model: PackageModel): BodyPatchability {
  // Resolve the body story defensively: a model with no body story is simply not editable (and
  // cannot be named), never a thrown error — the guards below must reach a diagnostic, not crash.
  let story: string;
  try {
    story = bodyStoryId(model);
  } catch {
    return { editable: false, diagnostic: { code: 'empty-body', message: 'model has no body story', story: '', missingLane: 'lossless-capture' } };
  }
  const ro = (d: Omit<ReadOnlyDiagnostic, 'story'>): BodyPatchability => ({ editable: false, diagnostic: { ...d, story } });
  const pres = model.preservation;
  if (!pres) return ro({ code: 'no-preservation', message: 'document has no preservation snapshot (not parsed losslessly)', missingLane: 'preservation' });
  const docText = pres.originalParts.get(DOC_PART);
  if (docText === undefined) return ro({ code: 'no-document-part', message: `no ${DOC_PART} in the preservation snapshot`, missingLane: 'preservation' });
  const blocks = model.stories.get(story)?.blocks ?? [];
  if (blocks.length === 0) return ro({ code: 'empty-body', message: 'the body has no blocks to edit', missingLane: 'lossless-capture' });

  const ranges: { start: number; end: number }[] = [];
  for (const b of blocks) {
    const qname = BLOCK_QNAME[b.kind];
    if (!isTopLevelEditable(b.kind)) {
      return ro({ code: 'non-editable-kind', message: `body block '${b.kind}' (${qname ?? b.kind}) is not top-level editable; it opens read-only to preserve it`, blockId: b.id, blockKind: b.kind, qname, missingLane: 'editable-capability' });
    }
    const r = pres.blockRanges.get(b.id);
    if (!r || r.partName !== DOC_PART) {
      return ro({ code: 'no-source-range', message: `block '${b.id}' (${qname ?? b.kind}) has no captured source range in ${DOC_PART}`, blockId: b.id, blockKind: b.kind, qname, missingLane: 'source-range' });
    }
    if (!sliceIsFullyCapturedParagraph(docText.slice(r.start, r.end))) {
      return ro({ code: 'unmodeled-content', message: `paragraph '${b.id}' (${qname ?? b.kind}) carries OOXML the model does not fully capture; editing it needs preservation capsules`, blockId: b.id, blockKind: b.kind, qname, missingLane: 'lossless-capture' });
    }
    ranges.push({ start: r.start, end: r.end });
  }
  // The body blocks must be CONTIGUOUS direct siblings. Any bytes between consecutive block ranges —
  // an inter-block comment/PI, a bookmark, or a wrapping element's boundary (an SDT or
  // </w:customXml>) — would be dropped the moment a structural edit regenerates the block region.
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i].start !== ranges[i - 1].end) {
      return ro({ code: 'non-contiguous-blocks', message: 'unowned bytes between sibling body blocks (a comment, bookmark, or wrapping boundary) would be lost on a structural edit', missingLane: 'contiguity' });
    }
  }
  return { editable: true };
}


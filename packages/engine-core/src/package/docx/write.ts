// DOCX package WRITER (document-engine): PackageModel -> valid DOCX bytes. A parsed
// document re-emits every preserved part byte-for-byte with only the main document part
// patched from the preservation index; a from-scratch model emits a COMPLETE, VALIDATED
// package (task 3.7): content types, relationships, and every declared XML part serialized
// FROM THE MODEL, failing closed on anything it cannot faithfully serialize.

import { writeZip, strToU8 } from '../zip.ts';
import { blockXml } from '../wml-serialize.ts';
import { W_NS } from '../wml-parse.ts';
import { escapeXmlChecked } from '../sinks.ts';
import { DOC_PART, emitPreservedPart } from '../wml-preserve.ts';
import { buildRelationshipSet, resolveRelationship, type RelationshipRecord } from '../relationships.ts';
import { buildContentTypeIndex, resolveContentType, type ContentTypeRecords } from '../content-types.ts';
import {
  bodyStoryId,
  validatePreservation,
  canonicalRunProps,
  canonicalParagraphProps,
  REL_TYPES,
  CONTENT_TYPES,
  type PackageModel,
  type Block,
  type ParagraphRecord,
  type StyleRecord,
  type NumberingRecord,
  type RunProps,
  type DocDefaults,
} from '../../model/index.ts';

const XML_DECL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

const MAIN_PART = '/word/document.xml';

/** Validate (fail-closed) then XML-escape an authored value bound for an owned attribute/text node. */
const xmlAttr = escapeXmlChecked;

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
  return `${XML_DECL}<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`;
}

// NOTE: from-scratch export supports ONLY a body story. Header/footer parts additionally require a
// w:sectPr in document.xml carrying w:headerReference/w:footerReference (with the relationship id)
// to actually attach in Word — which the model does not yet represent — so emitting the part alone
// would be inert. Note/comment stories need item wrappers with required ids. Rather than emit an
// inert or invalid part, from-scratch export FAILS CLOSED on every non-body story (see writeDocx).
// Opened documents with headers/footers round-trip losslessly through the verbatim PRESERVED path.

// --- OPC scaffolding serializers (from the model, NOT hardcoded) ---

function contentTypesXml(ct: ContentTypeRecords): string {
  const defaults = [...ct.defaults]
    .sort((a, b) => a.order - b.order)
    .map((d) => `<Default Extension="${xmlAttr(d.extension, 'content-type extension')}" ContentType="${xmlAttr(d.contentType, 'content type')}"/>`)
    .join('');
  const overrides = [...ct.overrides]
    .sort((a, b) => a.order - b.order)
    .map((o) => `<Override PartName="${xmlAttr(o.partName, 'content-type part name')}" ContentType="${xmlAttr(o.contentType, 'content type')}"/>`)
    .join('');
  return `${XML_DECL}<Types xmlns="${CT_NS}">${defaults}${overrides}</Types>`;
}

function relationshipsXml(recs: readonly RelationshipRecord[]): string {
  const rels = [...recs]
    .sort((a, b) => a.order - b.order)
    .map(
      (r) =>
        `<Relationship Id="${xmlAttr(r.id, 'relationship id')}" Type="${xmlAttr(r.type, 'relationship type')}" Target="${xmlAttr(r.rawTarget, 'relationship target')}"` +
        `${r.targetMode === 'External' ? ' TargetMode="External"' : ''}/>`,
    )
    .join('');
  return `${XML_DECL}<Relationships xmlns="${REL_NS}">${rels}</Relationships>`;
}

/** The rels part path for an owner part: `/word/document.xml` -> `/word/_rels/document.xml.rels`,
 *  and the package root `/` -> `/_rels/.rels`. */
function relsPathFor(ownerPart: string): string {
  if (ownerPart === '/') return '/_rels/.rels';
  const slash = ownerPart.lastIndexOf('/');
  const dir = ownerPart.slice(0, slash); // '' for a top-level part
  const name = ownerPart.slice(slash + 1);
  return `${dir}/_rels/${name}.rels`;
}

function rPrXml(p: RunProps): string {
  let s = '';
  if (p.bold !== undefined) s += p.bold ? '<w:b/>' : '<w:b w:val="0"/>';
  if (p.italic !== undefined) s += p.italic ? '<w:i/>' : '<w:i w:val="0"/>';
  if (p.underline !== undefined) s += p.underline ? '<w:u w:val="single"/>' : '<w:u w:val="none"/>';
  return s ? `<w:rPr>${s}</w:rPr>` : '';
}

function stylesXml(styles: readonly StyleRecord[], docDefaults?: DocDefaults): string {
  // w:docDefaults (the lowest style-resolution layer) must round-trip too, or a from-scratch model's
  // document-wide defaults are silently lost.
  const defaults =
    docDefaults?.runProps && rPrXml(docDefaults.runProps)
      ? `<w:docDefaults><w:rPrDefault>${rPrXml(docDefaults.runProps)}</w:rPrDefault></w:docDefaults>`
      : '';
  const body = styles
    .map((st) => {
      const name = `<w:name w:val="${xmlAttr(st.name, 'style name')}"/>`;
      const basedOn = st.basedOn ? `<w:basedOn w:val="${xmlAttr(st.basedOn, 'style basedOn')}"/>` : '';
      const rPr = st.runProps ? rPrXml(st.runProps) : '';
      return (
        `<w:style w:type="${xmlAttr(st.type, 'style type')}" w:styleId="${xmlAttr(st.id, 'style id')}"${st.isDefault ? ' w:default="1"' : ''}>` +
        `${name}${basedOn}${rPr}</w:style>`
      );
    })
    .join('');
  return `${XML_DECL}<w:styles xmlns:w="${W_NS}">${defaults}${body}</w:styles>`;
}

function numberingXml(nums: readonly NumberingRecord[]): string {
  const body = nums
    .map((n) => `<w:num w:numId="${xmlAttr(n.numId, 'numId')}"><w:abstractNumId w:val="${xmlAttr(n.abstractId, 'abstractNumId')}"/></w:num>`)
    .join('');
  return `${XML_DECL}<w:numbering xmlns:w="${W_NS}">${body}</w:numbering>`;
}

/** Validate the from-scratch OPC package invariants before writing so the output is guaranteed
 *  openable: the content-type index builds AND resolves the main document part to the required
 *  wordprocessingml main type (override precedence honored), the relationship set builds, and there
 *  is EXACTLY ONE internal root officeDocument relationship resolving to word/document.xml. */
function assertFromScratchPackageValid(model: PackageModel): void {
  const ct = buildContentTypeIndex(model.contentTypes);
  if (!ct.ok) throw new Error(`invalid content types: ${JSON.stringify(ct.error)}`);
  // Resolve (not merely search) so a removed override that falls through to a generic xml Default is
  // caught — the main part MUST resolve to the wordprocessingml main type.
  const mainCt = resolveContentType(ct.index, MAIN_PART);
  if (!mainCt.ok || mainCt.contentType !== CONTENT_TYPES.documentMain) {
    throw new Error('from-scratch package: /word/document.xml does not resolve to the main document content type');
  }
  const rels = buildRelationshipSet(model.relationships);
  if (!rels.ok) throw new Error(`invalid relationships: ${JSON.stringify(rels.error)}`);
  const rootOfficeDoc = (rels.byOwner.get('/') ?? []).filter((r) => r.type === REL_TYPES.officeDocument);
  const internalToMain = rootOfficeDoc.filter((r) => {
    const resolved = resolveRelationship(r);
    return resolved.mode === 'Internal' && resolved.target.ok && resolved.target.partName === MAIN_PART;
  });
  if (internalToMain.length !== 1) {
    throw new Error('from-scratch package: expected exactly one internal root officeDocument relationship to /word/document.xml');
  }
}

/** Fail closed on any authored feature the from-scratch serializer cannot round-trip losslessly, so
 *  whatever it DOES emit reopens to an equivalent authored state. The preservation-oriented model
 *  does not fully represent numbering definitions, the complete run-formatting vocabulary, or
 *  verbatim capsules from parse; rather than emit lossy/invalid OOXML, reject them here. */
function assertFromScratchSerializable(model: PackageModel): void {
  // Only a body story is serializable from scratch (headers/footers need section references we do
  // not model). Validate STORIES directly — a story with no backing part would otherwise be silently
  // dropped by the parts loop.
  for (const story of model.stories.values()) {
    if (story.kind !== 'body') {
      throw new Error(`from-scratch export supports only a body story, not '${story.kind}' (section references / item wrappers not modeled)`);
    }
  }
  if (model.numbering.length > 0) {
    throw new Error('from-scratch export cannot emit numbering (abstract list definitions are not modeled) — fails closed');
  }
  const walk = (blocks: readonly Block[]): void => {
    for (const b of blocks) {
      if (b.kind !== 'paragraph') {
        // table/sdt are preservation-only (never authored from scratch); their serializer already
        // fails closed, but reject early with a clear message.
        throw new Error(`from-scratch export cannot serialize a '${b.kind}' block (preservation-only)`);
      }
      const p = b as ParagraphRecord;
      if (p.pPrCapsule || p.pAttrsCapsule) {
        throw new Error('from-scratch export cannot carry a preservation capsule (capsules originate only from parse)');
      }
      const cp = canonicalParagraphProps(p.props); // degenerate '' numId canonicalizes to absent
      if (cp?.numId !== undefined || cp?.ilvl !== undefined) {
        throw new Error('from-scratch export cannot emit paragraph numbering (numPr) — the list definition is not modeled');
      }
      for (const r of p.runs) {
        if (r.rPrCapsule) throw new Error('from-scratch export cannot carry a run rPr capsule (verbatim capsule injection risk; capsules come only from parse)');
        // Only the round-trippable run subset (styleId + bold/italic presence) is serialized; an
        // explicit-false toggle or underline would not reparse to the same value, so fail closed.
        const rp = canonicalRunProps(r.props);
        if (rp?.underline !== undefined) throw new Error('from-scratch export cannot emit run underline (not round-trippable via the presence-based parser)');
        if (rp?.bold === false || rp?.italic === false) throw new Error('from-scratch export cannot emit an explicit-false run toggle (parser is presence-based)');
      }
    }
  };
  walk(model.stories.get(bodyStoryId(model))!.blocks);
}

/**
 * Serialize a PackageModel into DOCX bytes. When the model retains the original
 * package (a parsed document), EVERY part is re-emitted byte-for-byte and only the
 * main document part is patched from the preservation index — so an unedited document
 * round-trips losslessly (styles, rels, media, headers all survive). A model with no
 * retained package (created from scratch) emits a COMPLETE, VALIDATED package from the
 * model: content types, relationships (grouped by owner), and every declared XML part;
 * it FAILS CLOSED on any declared part or story kind it cannot faithfully serialize
 * rather than emit an incomplete package with dangling relationships.
 */
export function writeDocx(model: PackageModel): Uint8Array {
  const preserved = model.preservation?.packageParts;
  if (preserved && preserved.size > 0) {
    const entries = new Map(preserved);
    entries.set(DOC_PART, strToU8(documentXml(model))); // patch only the main document part
    return writeZip(entries);
  }

  // From-scratch: validate OPC invariants + fail closed on anything not faithfully serializable,
  // then build the whole package from the model.
  assertFromScratchPackageValid(model);
  assertFromScratchSerializable(model);
  const entries = new Map<string, Uint8Array>();
  entries.set('/[Content_Types].xml', strToU8(contentTypesXml(model.contentTypes)));

  // Relationships, grouped by owner part -> the owner's .rels part.
  const relsByOwner = new Map<string, RelationshipRecord[]>();
  for (const r of model.relationships) {
    const list = relsByOwner.get(r.ownerPart) ?? [];
    list.push(r);
    relsByOwner.set(r.ownerPart, list);
  }
  for (const [owner, recs] of relsByOwner) entries.set(relsPathFor(owner), strToU8(relationshipsXml(recs)));

  // EVERY declared XML part must be emitted with faithful content; a declared part we cannot
  // serialize (customXml, media, an unknown xml part) fails closed rather than leaving a dangling
  // content-type/relationship pointing at a missing part.
  const bodyId = bodyStoryId(model);
  for (const [partName, part] of model.parts) {
    if (part.kind === 'media') {
      throw new Error(`from-scratch export cannot serialize media part ${partName} (no authored bytes)`);
    }
    if (partName === MAIN_PART) entries.set(partName, strToU8(documentXml(model)));
    else if (partName === '/word/styles.xml') entries.set(partName, strToU8(stylesXml(model.styles, model.docDefaults)));
    else if (partName === '/word/numbering.xml') entries.set(partName, strToU8(numberingXml(model.numbering)));
    else if (part.storyId && part.storyId !== bodyId) {
      // A related story (header/footer/note/comment) needs section references / item wrappers we do
      // not yet model — emitting the part alone would be inert or invalid, so fail closed.
      throw new Error(`from-scratch export cannot serialize related story part ${partName} (section references not modeled)`);
    } else {
      throw new Error(`from-scratch export cannot serialize declared part ${partName}`);
    }
  }
  if (!entries.has(MAIN_PART)) throw new Error('from-scratch package declares no main document part');
  return writeZip(entries);
}

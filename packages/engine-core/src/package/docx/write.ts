// DOCX package WRITER (document-engine): PackageModel -> valid DOCX bytes. A parsed
// document re-emits every preserved part byte-for-byte with only the main document part
// patched from the preservation index; a from-scratch model emits a COMPLETE, VALIDATED
// package (task 3.7): content types, relationships, and every declared XML part serialized
// FROM THE MODEL, failing closed on anything it cannot faithfully serialize.

import { writeZip, strToU8 } from '../zip.ts';
import { blockXml } from '../wml-serialize.ts';
import { W_NS } from '../wml-parse.ts';
import { escapeXml } from '../sinks.ts';
import { DOC_PART, emitPreservedPart } from '../wml-preserve.ts';
import { buildRelationshipSet, type RelationshipRecord } from '../relationships.ts';
import { buildContentTypeIndex, type ContentTypeRecords } from '../content-types.ts';
import {
  bodyStoryId,
  validatePreservation,
  REL_TYPES,
  CONTENT_TYPES,
  type PackageModel,
  type Story,
  type StyleRecord,
  type NumberingRecord,
  type RunProps,
} from '../../model/index.ts';

const XML_DECL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

const MAIN_PART = '/word/document.xml';

/** True for a code unit forbidden in XML 1.0 char data: a control char other than tab/LF/CR, or the
 *  non-characters U+FFFE/U+FFFF. (Surrogates are validated as pairs below.) */
function isForbiddenXmlUnit(cu: number): boolean {
  if (cu === 0x9 || cu === 0xa || cu === 0xd) return false;
  if (cu < 0x20) return true;
  return cu === 0xfffe || cu === 0xffff;
}

/**
 * Validate then XML-escape an authored value bound for an owned attribute/text node. escapeXml
 * handles &<>"' but leaves control chars, U+FFFE/U+FFFF, and unpaired surrogates — which would emit
 * malformed XML — so reject them fail-closed (a hostile/garbage value can never produce an
 * unopenable part).
 */
function xmlAttr(value: string, what: string): string {
  for (let i = 0; i < value.length; i++) {
    const cu = value.charCodeAt(i);
    if (isForbiddenXmlUnit(cu)) throw new Error(`${what} contains a character not valid in XML 1.0`);
    if (cu >= 0xd800 && cu <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error(`${what} contains an unpaired surrogate`);
      i++; // consume the valid low surrogate
    } else if (cu >= 0xdc00 && cu <= 0xdfff) {
      throw new Error(`${what} contains an unpaired surrogate`);
    }
  }
  return escapeXml(value);
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
  return `${XML_DECL}<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`;
}

/** Serialize a header/footer story into its part root. Only w:hdr / w:ftr are supported from scratch
 *  (note/comment stories need item wrappers with required ids AND section references we do not yet
 *  emit); any other kind fails closed rather than emit an inert/invalid part. */
function storyXml(story: Story): string {
  if (story.kind !== 'header' && story.kind !== 'footer') {
    throw new Error(`from-scratch export of a '${story.kind}' story is not supported (would emit an invalid or inert part)`);
  }
  const inner = story.blocks.map(blockXml).join('');
  const root = story.kind === 'header' ? 'w:hdr' : 'w:ftr';
  return `${XML_DECL}<${root} xmlns:w="${W_NS}">${inner}</${root}>`;
}

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

function stylesXml(styles: readonly StyleRecord[]): string {
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
  return `${XML_DECL}<w:styles xmlns:w="${W_NS}">${body}</w:styles>`;
}

function numberingXml(nums: readonly NumberingRecord[]): string {
  const body = nums
    .map((n) => `<w:num w:numId="${xmlAttr(n.numId, 'numId')}"><w:abstractNumId w:val="${xmlAttr(n.abstractId, 'abstractNumId')}"/></w:num>`)
    .join('');
  return `${XML_DECL}<w:numbering xmlns:w="${W_NS}">${body}</w:numbering>`;
}

/** Validate the from-scratch package invariants before writing so the output is guaranteed openable:
 *  content-type index builds (no conflicting defaults / duplicate overrides / invalid MIME), the
 *  relationship set builds (no duplicate ids per owner), the required root officeDocument
 *  relationship and the main-part content type are present. Fails closed on any violation. */
function assertFromScratchPackageValid(model: PackageModel): void {
  const ct = buildContentTypeIndex(model.contentTypes);
  if (!ct.ok) throw new Error(`invalid content types: ${JSON.stringify(ct.error)}`);
  const rels = buildRelationshipSet(model.relationships);
  if (!rels.ok) throw new Error(`invalid relationships: ${JSON.stringify(rels.error)}`);
  const rootRels = rels.byOwner.get('/') ?? [];
  if (!rootRels.some((r) => r.type === REL_TYPES.officeDocument && r.rawTarget.replace(/^\//, '') === 'word/document.xml')) {
    throw new Error('from-scratch package missing the required root officeDocument relationship to word/document.xml');
  }
  const hasMainCt =
    model.contentTypes.overrides.some((o) => o.partName === MAIN_PART && o.contentType === CONTENT_TYPES.documentMain) ||
    model.contentTypes.defaults.some((d) => d.extension.toLowerCase() === 'xml');
  if (!hasMainCt) throw new Error('from-scratch package missing the main document content type');
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

  // From-scratch: validate OPC invariants, then build the whole package from the model.
  assertFromScratchPackageValid(model);
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
    else if (partName === '/word/styles.xml') entries.set(partName, strToU8(stylesXml(model.styles)));
    else if (partName === '/word/numbering.xml') entries.set(partName, strToU8(numberingXml(model.numbering)));
    else if (part.storyId && part.storyId !== bodyId) {
      const story = model.stories.get(part.storyId);
      if (!story) throw new Error(`declared part ${partName} references missing story ${part.storyId}`);
      entries.set(partName, strToU8(storyXml(story))); // storyXml fails closed on unsupported kinds
    } else {
      throw new Error(`from-scratch export cannot serialize declared part ${partName}`);
    }
  }
  if (!entries.has(MAIN_PART)) throw new Error('from-scratch package declares no main document part');
  return writeZip(entries);
}

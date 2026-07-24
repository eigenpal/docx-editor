// DOCX package WRITER (document-engine): PackageModel -> valid DOCX bytes. A parsed
// document re-emits every preserved part byte-for-byte with only the main document part
// patched from the preservation index; a from-scratch model emits a COMPLETE minimal
// package (task 3.7): content types, relationships, and every declared XML part
// (document / styles / numbering / related stories), all serialized FROM THE MODEL.

import { writeZip, strToU8 } from '../zip.ts';
import { blockXml } from '../wml-serialize.ts';
import { W_NS } from '../wml-parse.ts';
import { escapeXml } from '../sinks.ts';
import { DOC_PART, emitPreservedPart } from '../wml-preserve.ts';
import {
  bodyStoryId,
  validatePreservation,
  type PackageModel,
  type Story,
  type StyleRecord,
  type NumberingRecord,
  type RunProps,
} from '../../model/index.ts';
import type { RelationshipRecord } from '../relationships.ts';
import type { ContentTypeRecords } from '../content-types.ts';

const XML_DECL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

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

/** Serialize a non-body story (header/footer/note/comment) into its part's root element. */
function storyXml(story: Story): string {
  const inner = story.blocks.map(blockXml).join('');
  const root =
    story.kind === 'header' ? 'w:hdr' : story.kind === 'footer' ? 'w:ftr' : 'w:body'; // notes/comments rarely round-trip from scratch; body-ish fallback
  return `${XML_DECL}<${root} xmlns:w="${W_NS}">${inner}</${root}>`;
}

// --- OPC scaffolding serializers (from the model, NOT hardcoded) ---

function contentTypesXml(ct: ContentTypeRecords): string {
  const defaults = [...ct.defaults]
    .sort((a, b) => a.order - b.order)
    .map((d) => `<Default Extension="${escapeXml(d.extension)}" ContentType="${escapeXml(d.contentType)}"/>`)
    .join('');
  const overrides = [...ct.overrides]
    .sort((a, b) => a.order - b.order)
    .map((o) => `<Override PartName="${escapeXml(o.partName)}" ContentType="${escapeXml(o.contentType)}"/>`)
    .join('');
  return `${XML_DECL}<Types xmlns="${CT_NS}">${defaults}${overrides}</Types>`;
}

function relationshipsXml(recs: readonly RelationshipRecord[]): string {
  const rels = [...recs]
    .sort((a, b) => a.order - b.order)
    .map(
      (r) =>
        `<Relationship Id="${escapeXml(r.id)}" Type="${escapeXml(r.type)}" Target="${escapeXml(r.rawTarget)}"` +
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
      const name = `<w:name w:val="${escapeXml(st.name)}"/>`;
      const basedOn = st.basedOn ? `<w:basedOn w:val="${escapeXml(st.basedOn)}"/>` : '';
      const rPr = st.runProps ? rPrXml(st.runProps) : '';
      return (
        `<w:style w:type="${escapeXml(st.type)}" w:styleId="${escapeXml(st.id)}"${st.isDefault ? ' w:default="1"' : ''}>` +
        `${name}${basedOn}${rPr}</w:style>`
      );
    })
    .join('');
  return `${XML_DECL}<w:styles xmlns:w="${W_NS}">${body}</w:styles>`;
}

function numberingXml(nums: readonly NumberingRecord[]): string {
  const body = nums
    .map((n) => `<w:num w:numId="${escapeXml(n.numId)}"><w:abstractNumId w:val="${escapeXml(n.abstractId)}"/></w:num>`)
    .join('');
  return `${XML_DECL}<w:numbering xmlns:w="${W_NS}">${body}</w:numbering>`;
}

/**
 * Serialize a PackageModel into DOCX bytes. When the model retains the original
 * package (a parsed document), EVERY part is re-emitted byte-for-byte and only the
 * main document part is patched from the preservation index — so an unedited document
 * round-trips losslessly (styles, rels, media, headers all survive). A model with no
 * retained package (created from scratch) emits a COMPLETE package from the model:
 * content types, relationships (grouped by owner), and every declared XML part.
 */
export function writeDocx(model: PackageModel): Uint8Array {
  const preserved = model.preservation?.packageParts;
  if (preserved && preserved.size > 0) {
    const entries = new Map(preserved);
    entries.set(DOC_PART, strToU8(documentXml(model))); // patch only the main document part
    return writeZip(entries);
  }

  // From-scratch: build the whole package from the model so it is a COMPLETE, valid OPC package
  // (required content types + relationships + declared parts), not a document-only stub.
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

  // Every declared XML part, content serialized from the model. Media parts have no from-scratch
  // bytes (a created model references none); an xml part with a story emits that story.
  const bodyId = bodyStoryId(model);
  for (const [partName, part] of model.parts) {
    if (part.kind !== 'xml') continue;
    if (partName === '/word/document.xml') entries.set(partName, strToU8(documentXml(model)));
    else if (partName === '/word/styles.xml') entries.set(partName, strToU8(stylesXml(model.styles)));
    else if (partName === '/word/numbering.xml') entries.set(partName, strToU8(numberingXml(model.numbering)));
    else if (part.storyId && part.storyId !== bodyId) {
      const story = model.stories.get(part.storyId);
      if (story) entries.set(partName, strToU8(storyXml(story)));
    }
  }
  // Safety net: if the model declared no document part (unusual), still emit one so the package is
  // openable.
  if (!entries.has('/word/document.xml')) entries.set('/word/document.xml', strToU8(documentXml(model)));
  return writeZip(entries);
}

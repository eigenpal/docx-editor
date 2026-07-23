// DOCX package WRITER (document-engine): PackageModel -> valid DOCX bytes. A parsed
// document re-emits every preserved part byte-for-byte with only the main document part
// patched from the preservation index; a from-scratch model emits a minimal document.

import { writeZip, strToU8 } from '../zip.ts';
import { blockXml } from '../wml-serialize.ts';
import { W_NS } from '../wml-parse.ts';
import { DOC_PART, emitPreservedPart } from '../wml-preserve.ts';
import { bodyStoryId, validatePreservation, type PackageModel } from '../../model/index.ts';


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

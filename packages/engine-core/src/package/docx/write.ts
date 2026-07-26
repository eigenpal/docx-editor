// DOCX package WRITER (document-engine): PackageModel -> valid DOCX bytes. A parsed
// document re-emits every preserved part byte-for-byte with only the main document part
// patched from the preservation index; a from-scratch model emits a COMPLETE, VALIDATED
// package (task 3.7): content types, relationships, and every declared XML part serialized
// FROM THE MODEL, failing closed on anything it cannot faithfully serialize.

import { writeZip, strToU8 } from '../zip.ts';
import { blockXml, runPropsChildrenXml } from '../wml-serialize.ts';
import { W_NS } from '../wml-parse.ts';
import { escapeXmlChecked } from '../sinks.ts';
import { DOC_PART, emitPreservedPart, hashStoryContent } from '../wml-preserve.ts';
import { parseThemeFonts } from '../wml-parts.ts';
import { canonicalize } from '../../comparators/index.ts';
import {
  buildRelationshipSet,
  resolveRelationship,
  type RelationshipRecord,
} from '../relationships.ts';
import {
  buildContentTypeIndex,
  resolveContentType,
  type ContentTypeRecords,
} from '../content-types.ts';
import {
  bodyStoryId,
  validatePreservation,
  canonicalParagraphProps,
  canonicalStyle,
  canonicalDocDefaults,
  REL_TYPES,
  CONTENT_TYPES,
  type PackageModel,
  type Block,
  type ParagraphRecord,
  type StyleRecord,
  type NumberingRecord,
  type DocDefaults,
  type ThemeFonts,
} from '../../model/index.ts';

const XML_DECL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

const MAIN_PART = '/word/document.xml';
const DRAWINGML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

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
    .map(
      (d) =>
        `<Default Extension="${xmlAttr(d.extension, 'content-type extension')}" ContentType="${xmlAttr(d.contentType, 'content type')}"/>`
    )
    .join('');
  const overrides = [...ct.overrides]
    .sort((a, b) => a.order - b.order)
    .map(
      (o) =>
        `<Override PartName="${xmlAttr(o.partName, 'content-type part name')}" ContentType="${xmlAttr(o.contentType, 'content type')}"/>`
    )
    .join('');
  return `${XML_DECL}<Types xmlns="${CT_NS}">${defaults}${overrides}</Types>`;
}

function relationshipsXml(recs: readonly RelationshipRecord[]): string {
  const rels = [...recs]
    .sort((a, b) => a.order - b.order)
    .map(
      (r) =>
        `<Relationship Id="${xmlAttr(r.id, 'relationship id')}" Type="${xmlAttr(r.type, 'relationship type')}" Target="${xmlAttr(r.rawTarget, 'relationship target')}"` +
        `${r.targetMode === 'External' ? ' TargetMode="External"' : ''}/>`
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

function styleRPrXml(props: NonNullable<StyleRecord['runProps']>): string {
  const children = runPropsChildrenXml(props, false);
  return children ? `<w:rPr>${children}</w:rPr>` : '';
}

function stylesXml(styles: readonly StyleRecord[], docDefaults?: DocDefaults): string {
  // Canonicalize so the emitted bytes match the digest + what the parser yields on reopen. w:docDefaults
  // (the lowest style-resolution layer) round-trips too, or a from-scratch model's defaults are lost.
  const dd = canonicalDocDefaults(docDefaults);
  const defaults = dd
    ? `<w:docDefaults><w:rPrDefault>${styleRPrXml(dd.runProps!)}</w:rPrDefault></w:docDefaults>`
    : '';
  const body = styles
    .map((raw) => {
      const st = canonicalStyle(raw);
      if (!st.id)
        throw new Error(
          'from-scratch export cannot emit a style with an empty styleId (would be dropped on reopen)'
        );
      const name = `<w:name w:val="${xmlAttr(st.name, 'style name')}"/>`;
      const basedOn = st.basedOn
        ? `<w:basedOn w:val="${xmlAttr(st.basedOn, 'style basedOn')}"/>`
        : '';
      const rPr = st.runProps ? styleRPrXml(st.runProps) : '';
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
    .map(
      (n) =>
        `<w:num w:numId="${xmlAttr(n.numId, 'numId')}"><w:abstractNumId w:val="${xmlAttr(n.abstractId, 'abstractNumId')}"/></w:num>`
    )
    .join('');
  return `${XML_DECL}<w:numbering xmlns:w="${W_NS}">${body}</w:numbering>`;
}

function themeXml(fonts: ThemeFonts): string {
  const face = (element: string, value: string | undefined, label: string): string =>
    `<a:${element} typeface="${xmlAttr(value ?? '', `theme ${label} typeface`)}"/>`;
  const colorScheme =
    '<a:clrScheme name="Generated Colors">' +
    '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
    '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
    '<a:dk2><a:srgbClr val="44546A"/></a:dk2>' +
    '<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
    '<a:accent1><a:srgbClr val="4472C4"/></a:accent1>' +
    '<a:accent2><a:srgbClr val="ED7D31"/></a:accent2>' +
    '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>' +
    '<a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
    '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>' +
    '<a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
    '<a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
    '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
    '</a:clrScheme>';
  const formatScheme =
    '<a:fmtScheme name="Generated Format">' +
    '<a:fillStyleLst><a:solidFill/><a:solidFill/><a:solidFill/></a:fillStyleLst>' +
    '<a:lnStyleLst><a:ln/><a:ln/><a:ln/></a:lnStyleLst>' +
    '<a:effectStyleLst>' +
    '<a:effectStyle><a:effectLst/></a:effectStyle>' +
    '<a:effectStyle><a:effectLst/></a:effectStyle>' +
    '<a:effectStyle><a:effectLst/></a:effectStyle>' +
    '</a:effectStyleLst>' +
    '<a:bgFillStyleLst><a:solidFill/><a:solidFill/><a:solidFill/></a:bgFillStyleLst>' +
    '</a:fmtScheme>';
  return (
    `${XML_DECL}<a:theme xmlns:a="${DRAWINGML_NS}" name="Generated Theme">` +
    `<a:themeElements>${colorScheme}<a:fontScheme name="Generated Fonts">` +
    `<a:majorFont>${face('latin', fonts.majorLatin, 'major Latin')}` +
    `${face('ea', fonts.majorEastAsia, 'major East Asia')}` +
    `${face('cs', fonts.majorComplexScript, 'major complex script')}</a:majorFont>` +
    `<a:minorFont>${face('latin', fonts.minorLatin, 'minor Latin')}` +
    `${face('ea', fonts.minorEastAsia, 'minor East Asia')}` +
    `${face('cs', fonts.minorComplexScript, 'minor complex script')}</a:minorFont>` +
    `</a:fontScheme>${formatScheme}</a:themeElements></a:theme>`
  );
}

function nextThemeRelationshipId(relationships: readonly RelationshipRecord[]): string {
  const used = new Set(
    relationships.filter((rel) => rel.ownerPart === MAIN_PART).map((rel) => rel.id)
  );
  let id = 'rIdTheme';
  let suffix = 1;
  while (used.has(id)) id = `rIdTheme${suffix++}`;
  return id;
}

function prepareThemeExport(model: PackageModel): {
  readonly model: PackageModel;
  readonly themePartName?: string;
} {
  if (!model.themeFonts) return { model };
  const themeRelationships = model.relationships.filter(
    (rel) =>
      rel.ownerPart === MAIN_PART &&
      (rel.type === REL_TYPES.theme || rel.type === REL_TYPES.themeStrict)
  );
  if (themeRelationships.length > 1)
    throw new Error('from-scratch themeFonts require exactly one theme relationship');
  let relationship = themeRelationships[0];
  if (!relationship) {
    relationship = {
      ownerPart: MAIN_PART,
      id: nextThemeRelationshipId(model.relationships),
      type: REL_TYPES.theme,
      rawTarget: 'theme/theme1.xml',
      targetMode: 'Internal',
      order:
        Math.max(
          -1,
          ...model.relationships
            .filter((rel) => rel.ownerPart === MAIN_PART)
            .map((rel) => rel.order)
        ) + 1,
    };
  }
  const resolved = resolveRelationship(relationship);
  if (resolved.mode !== 'Internal' || !resolved.target.ok)
    throw new Error('from-scratch themeFonts require a valid internal theme relationship');
  const themePartName = resolved.target.partName;
  const parts = new Map(model.parts);
  if (!parts.has(themePartName)) parts.set(themePartName, { kind: 'xml', partName: themePartName });
  const existingThemeOverride = model.contentTypes.overrides.find(
    (record) => record.partName.toLowerCase() === themePartName.toLowerCase()
  );
  if (existingThemeOverride && existingThemeOverride.contentType !== CONTENT_TYPES.theme)
    throw new Error('theme part has a conflicting content type');
  const overrides = existingThemeOverride
    ? model.contentTypes.overrides
    : [
        ...model.contentTypes.overrides,
        {
          partName: themePartName,
          contentType: CONTENT_TYPES.theme,
          order: Math.max(-1, ...model.contentTypes.overrides.map((record) => record.order)) + 1,
        },
      ];
  return {
    model: {
      ...model,
      relationships: relationship
        ? model.relationships.includes(relationship)
          ? model.relationships
          : [...model.relationships, relationship]
        : model.relationships,
      contentTypes: { ...model.contentTypes, overrides },
      parts,
    },
    themePartName,
  };
}

function assertPreservedThemeUnchanged(
  model: PackageModel,
  preserved: ReadonlyMap<string, Uint8Array>
): void {
  const parsed = parseThemeFonts(preserved);
  if (!parsed.ok) throw new Error(`cannot validate preserved theme bytes: ${parsed.detail}`);
  if (canonicalize(model.themeFonts ?? null) !== canonicalize(parsed.fonts ?? null))
    throw new Error(
      'themeFonts changed from the preserved theme; theme part regeneration is not supported'
    );
}

/** Fail closed if any related (non-body) story diverges from its parse-time baseline — the preserved
 *  export re-emits those parts verbatim, so it cannot reflect such an edit and must not silently drop
 *  it. (Related-story patching is a future increment; until then a related edit is rejected.) */
function assertRelatedStoriesUnchanged(model: PackageModel): void {
  const baselines = model.preservation?.relatedStoryHashes;
  for (const story of model.stories.values()) {
    if (story.kind === 'body') continue;
    const baseline = baselines?.get(story.id);
    // A related story with a baseline that no longer matches was edited; one with NO baseline was
    // added after parse. Either way the verbatim export cannot represent it — fail closed.
    if (baseline === undefined || baseline !== hashStoryContent(story.blocks)) {
      throw new Error(
        `related story ${story.id} (${story.kind}) was edited; the preserved export cannot patch related-story parts yet — rejected to avoid silent loss`
      );
    }
  }
}

/** The set of part names writeDocx WILL emit for a from-scratch model: the main document part, every
 *  declared xml part (media parts already fail closed earlier), and the .rels part for every owner
 *  that has relationships. Used to close the OPC graph (content-type coverage + target resolution). */
function emittedPartNames(model: PackageModel): Set<string> {
  const out = new Set<string>([MAIN_PART]);
  for (const [partName, part] of model.parts) if (part.kind === 'xml') out.add(partName);
  const owners = new Set(model.relationships.map((r) => r.ownerPart));
  for (const owner of owners) out.add(relsPathFor(owner));
  return out;
}

/** Validate the from-scratch OPC package invariants so the output is a CLOSED, openable graph: the
 *  content-type index builds and covers EVERY emitted part (the main part resolving to the
 *  wordprocessingml main type, override precedence honored); the relationship set builds; there is
 *  EXACTLY ONE root officeDocument relationship total, internal and resolving to word/document.xml;
 *  and every relationship's owner + internal target is an emitted part (no dangling edges). */
function assertFromScratchPackageValid(model: PackageModel): void {
  const ct = buildContentTypeIndex(model.contentTypes);
  if (!ct.ok) throw new Error(`invalid content types: ${JSON.stringify(ct.error)}`);
  const emitted = emittedPartNames(model);
  // Every emitted part must resolve to a content type (else Word cannot open it); the main part MUST
  // resolve to the wordprocessingml main type (resolve, not search — a fall-through xml Default is
  // caught).
  for (const part of emitted) {
    const r = resolveContentType(ct.index, part);
    if (!r.ok) throw new Error(`from-scratch package: emitted part ${part} has no content type`);
    if (part === MAIN_PART && r.contentType !== CONTENT_TYPES.documentMain) {
      throw new Error(
        'from-scratch package: /word/document.xml does not resolve to the main document content type'
      );
    }
  }
  const rels = buildRelationshipSet(model.relationships);
  if (!rels.ok) throw new Error(`invalid relationships: ${JSON.stringify(rels.error)}`);
  // Exactly one root officeDocument relationship TOTAL — internal, resolving to the main part. An
  // extra external/dangling one is rejected.
  const rootOfficeDoc = (rels.byOwner.get('/') ?? []).filter(
    (r) => r.type === REL_TYPES.officeDocument
  );
  if (rootOfficeDoc.length !== 1) {
    throw new Error(
      `from-scratch package: expected exactly one root officeDocument relationship, found ${rootOfficeDoc.length}`
    );
  }
  const rootResolved = resolveRelationship(rootOfficeDoc[0]);
  if (
    !(
      rootResolved.mode === 'Internal' &&
      rootResolved.target.ok &&
      rootResolved.target.partName === MAIN_PART
    )
  ) {
    throw new Error(
      'from-scratch package: the root officeDocument relationship must be internal and target /word/document.xml'
    );
  }
  // No dangling edges: every relationship's owner is the package root or an emitted part, and every
  // internal target resolves to an emitted part (external targets are validated for sink-safety).
  for (const rel of model.relationships) {
    if (rel.ownerPart !== '/' && !emitted.has(rel.ownerPart)) {
      throw new Error(
        `from-scratch package: relationship ${rel.id} has a non-existent owner ${rel.ownerPart}`
      );
    }
    const resolved = resolveRelationship(rel);
    if (resolved.mode === 'Internal') {
      if (!resolved.target.ok)
        throw new Error(
          `from-scratch package: relationship ${rel.id} has an invalid internal target ${rel.rawTarget}`
        );
      if (!emitted.has(resolved.target.partName)) {
        throw new Error(
          `from-scratch package: relationship ${rel.id} targets a non-emitted part ${resolved.target.partName}`
        );
      }
    } else if (!resolved.sinkSafe.ok) {
      throw new Error(`from-scratch package: relationship ${rel.id} has an unsafe external target`);
    }
  }
}

/** Fail closed on any authored feature the from-scratch serializer cannot round-trip losslessly, so
 *  whatever it DOES emit reopens to an equivalent authored state. The preservation-oriented model
 *  does not fully represent numbering definitions, the complete run-formatting vocabulary, or
 *  verbatim capsules from parse; rather than emit lossy/invalid OOXML, reject them here. */
function assertFromScratchSerializable(model: PackageModel): void {
  // EXACTLY ONE body story is serializable from scratch (headers/footers need section references we
  // do not model; a second body would be silently dropped by the single-document-part export while
  // the digest still counts it). Validate STORIES directly — a story with no backing part would
  // otherwise slip past the parts loop.
  let bodyCount = 0;
  for (const story of model.stories.values()) {
    if (story.kind !== 'body') {
      throw new Error(
        `from-scratch export supports only a body story, not '${story.kind}' (section references / item wrappers not modeled)`
      );
    }
    bodyCount += 1;
  }
  if (bodyCount !== 1)
    throw new Error(`from-scratch export requires exactly one body story, found ${bodyCount}`);
  if (model.numbering.length > 0) {
    throw new Error(
      'from-scratch export cannot emit numbering (abstract list definitions are not modeled) — fails closed'
    );
  }
  const walk = (blocks: readonly Block[]): void => {
    for (const b of blocks) {
      if (b.kind !== 'paragraph') {
        // table/sdt are preservation-only (never authored from scratch); their serializer already
        // fails closed, but reject early with a clear message.
        throw new Error(
          `from-scratch export cannot serialize a '${b.kind}' block (preservation-only)`
        );
      }
      const p = b as ParagraphRecord;
      if (p.pPrCapsule || p.pAttrsCapsule) {
        throw new Error(
          'from-scratch export cannot carry a preservation capsule (capsules originate only from parse)'
        );
      }
      const cp = canonicalParagraphProps(p.props); // degenerate '' numId canonicalizes to absent
      if (cp?.numId !== undefined || cp?.ilvl !== undefined) {
        throw new Error(
          'from-scratch export cannot emit paragraph numbering (numPr) — the list definition is not modeled'
        );
      }
      for (const r of p.runs) {
        if (r.rPrCapsule)
          throw new Error(
            'from-scratch export cannot carry a run rPr capsule (verbatim capsule injection risk; capsules come only from parse)'
          );
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
    // The preserved export patches ONLY the body document part and re-emits every other part
    // verbatim. An edit to a related (non-body) story would therefore be silently discarded, so fail
    // closed if any related story diverges from its parse-time baseline.
    assertRelatedStoriesUnchanged(model);
    assertPreservedThemeUnchanged(model, preserved);
    const entries = new Map(preserved);
    entries.set(DOC_PART, strToU8(documentXml(model))); // patch only the main document part
    return writeZip(entries);
  }

  // A flat (non-preserving) parse that DROPPED unmodeled OOXML (w:spacing, color, fonts, underline)
  // reached the from-scratch path — regenerating from the coarse model would silently lose that
  // formatting. Fail closed: such a document must be opened WITH preservation, not from-scratch
  // re-serialized. (createEmptyModel-origin models, and the flat parse of a fully-modeled document,
  // carry no dropped content and export fine.)
  if (model.lossyParse) {
    throw new Error(
      'cannot from-scratch export a model whose flat parse dropped unmodeled OOXML — open it with preservation (preserveAll)'
    );
  }

  // From-scratch: validate OPC invariants + fail closed on anything not faithfully serializable,
  // then build the whole package from the model.
  const prepared = prepareThemeExport(model);
  const exportModel = prepared.model;
  assertFromScratchPackageValid(exportModel);
  assertFromScratchSerializable(exportModel);
  const entries = new Map<string, Uint8Array>();
  entries.set('/[Content_Types].xml', strToU8(contentTypesXml(exportModel.contentTypes)));

  // Relationships, grouped by owner part -> the owner's .rels part.
  const relsByOwner = new Map<string, RelationshipRecord[]>();
  for (const r of exportModel.relationships) {
    const list = relsByOwner.get(r.ownerPart) ?? [];
    list.push(r);
    relsByOwner.set(r.ownerPart, list);
  }
  for (const [owner, recs] of relsByOwner)
    entries.set(relsPathFor(owner), strToU8(relationshipsXml(recs)));

  // EVERY declared XML part must be emitted with faithful content; a declared part we cannot
  // serialize (customXml, media, an unknown xml part) fails closed rather than leaving a dangling
  // content-type/relationship pointing at a missing part.
  const bodyId = bodyStoryId(exportModel);
  for (const [partName, part] of exportModel.parts) {
    if (part.kind === 'media') {
      throw new Error(
        `from-scratch export cannot serialize media part ${partName} (no authored bytes)`
      );
    }
    if (partName === MAIN_PART) entries.set(partName, strToU8(documentXml(exportModel)));
    else if (partName === '/word/styles.xml')
      entries.set(partName, strToU8(stylesXml(exportModel.styles, exportModel.docDefaults)));
    else if (partName === '/word/numbering.xml')
      entries.set(partName, strToU8(numberingXml(exportModel.numbering)));
    else if (partName === prepared.themePartName)
      entries.set(partName, strToU8(themeXml(exportModel.themeFonts!)));
    else if (part.storyId && part.storyId !== bodyId) {
      // A related story (header/footer/note/comment) needs section references / item wrappers we do
      // not yet model — emitting the part alone would be inert or invalid, so fail closed.
      throw new Error(
        `from-scratch export cannot serialize related story part ${partName} (section references not modeled)`
      );
    } else {
      throw new Error(`from-scratch export cannot serialize declared part ${partName}`);
    }
  }
  if (!entries.has(MAIN_PART))
    throw new Error('from-scratch package declares no main document part');
  return writeZip(entries);
}

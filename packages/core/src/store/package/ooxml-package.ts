// Bounded OPC loading into canonical typed OOXML trees (typed-ooxml-paragraph-editor task 4.4).
//
// Composes the already-hardened package primitives — `readZip` (entry/size/ratio limits and
// OPC name normalization), `normalizePartName` / `resolveInternalTarget` /
// `validateExternalTarget`, `buildContentTypeIndex`, and `buildRelationshipSet` — into ONE
// loader that produces `OoxmlPart` trees. It replaces nothing yet: `parseDocx` still builds
// the `PackageModel`, and this is the path that becomes authoritative as sections 5 and 6
// move the store and binding onto the tree (task 6.7 then deletes the byte-range model).
//
// Trust boundary rules enforced here, all of them fail-closed:
//   - every part name and every INTERNAL relationship target is re-normalized, so a
//     traversing or encoded target cannot name a part outside the package;
//   - an EXTERNAL relationship is recorded and sink-validated but NEVER resolved against
//     the package and NEVER fetched (CLAUDE.md: no zero-click external fetch);
//   - XML parsing inherits `readXml`'s DTD/entity refusal and byte/element caps;
//   - the number of parts converted into trees is capped, so a package cannot force
//     unbounded tree construction.

import {
  readZip,
  writeZip,
  strToU8,
  strFromU8,
  type ZipLimits,
  type ZipRejection,
  DEFAULT_ZIP_LIMITS,
} from './zip.ts';
import {
  readXml,
  XML_HARD_MAX_BYTES,
  type XmlLimits,
  type XmlNode,
  type XmlRejection,
} from './xml-reader.ts';
import { normalizePartName, type NameRejection } from './opc-names.ts';
import {
  buildRelationshipSet,
  resolveRelationship,
  type RelationshipRecord,
} from './relationships.ts';
import {
  buildContentTypeIndex,
  resolveContentType,
  type ContentTypeIndex,
  type DefaultRecord,
  type OverrideRecord,
} from './content-types.ts';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlPart,
  type OoxmlReadRejection,
} from './ooxml-tree.ts';

const CONTENT_TYPES_PART = '/[Content_Types].xml';
const CONTENT_TYPES_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/content-types';
const OFFICE_DOCUMENT_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** MIME types read into canonical trees. Anything else stays bytes (media, fonts, ...). */
const XML_CONTENT_TYPE_RE = /(?:\/xml|\+xml)$/i;

type XmlBytesResult =
  | { readonly ok: true; readonly xml: string }
  | { readonly ok: false; readonly reason: XmlRejection };

/**
 * A UTF-16 decoder for one of the WHATWG labels, typed for a build with no DOM.
 *
 * `TextDecoder` is a global in every runtime this ships to, but the neutral lanes compile with
 * the DOM lib deliberately omitted, and there its type comes from Node — whose `Encoding` union
 * is Buffer's (`utf16le`) rather than the WHATWG label set (`utf-16le`, `utf-16be`). The two
 * labels below are the ones an XML processor is required to recognize and the ones both runtimes
 * accept, so what is narrow is the TYPE, not the platform. Nothing about the decode changes:
 * same labels, same `fatal`, same call.
 */
type Utf16Label = 'utf-16le' | 'utf-16be';
type Utf16DecoderCtor = new (
  label: Utf16Label,
  options: { readonly fatal: true }
) => { decode(bytes: Uint8Array): string };

function utf16Decoder(label: Utf16Label): { decode(bytes: Uint8Array): string } {
  return new (TextDecoder as unknown as Utf16DecoderCtor)(label, { fatal: true });
}

/**
 * Decode the encodings XML processors are required to recognize without an encoding hint.
 * The raw-byte ceiling is checked before decoding so UTF-16 input cannot allocate past the
 * package reader's configured XML budget.
 */
function decodeXmlBytes(bytes: Uint8Array, limits?: XmlLimits): XmlBytesResult {
  const configuredMax = limits?.maxBytes ?? XML_HARD_MAX_BYTES;
  if (!Number.isFinite(configuredMax) || !Number.isInteger(configuredMax) || configuredMax < 0) {
    return { ok: false, reason: 'invalid-limits' };
  }
  if (bytes.byteLength > Math.min(configuredMax, XML_HARD_MAX_BYTES)) {
    return { ok: false, reason: 'too-large' };
  }

  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { ok: true, xml: utf16Decoder('utf-16le').decode(bytes.subarray(2)) };
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return { ok: true, xml: utf16Decoder('utf-16be').decode(bytes.subarray(2)) };
    }
    if (bytes[0] === 0x3c && bytes[1] === 0x00 && bytes[2] === 0x3f && bytes[3] === 0x00) {
      return { ok: true, xml: utf16Decoder('utf-16le').decode(bytes) };
    }
    if (bytes[0] === 0x00 && bytes[1] === 0x3c && bytes[2] === 0x00 && bytes[3] === 0x3f) {
      return { ok: true, xml: utf16Decoder('utf-16be').decode(bytes) };
    }
    const offset = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    return { ok: true, xml: strFromU8(bytes.subarray(offset)) };
  } catch {
    return { ok: false, reason: 'parse-error' };
  }
}

/** Caps applied while loading a package: zip, XML, part count and relationship count. */
export interface OoxmlPackageLimits {
  readonly zip?: ZipLimits;
  readonly xml?: XmlLimits;
  /** Cap on parts converted into canonical trees (N/N+1 gate, not a soft target). */
  readonly maxXmlParts?: number;
  /** Cap on relationship records across every rels part. */
  readonly maxRelationships?: number;
}

/** The limits in force when a host configures none. Conservative and finite. */
export const DEFAULT_OOXML_PACKAGE_LIMITS: Required<
  Pick<OoxmlPackageLimits, 'maxXmlParts' | 'maxRelationships'>
> = Object.freeze({ maxXmlParts: 512, maxRelationships: 10_000 });

/**
 * An external relationship target. Retained verbatim as authored evidence, with the
 * sink-safety verdict alongside it. Never resolved against the package, never fetched.
 */
export interface OoxmlExternalTarget {
  readonly ownerPart: string;
  readonly id: string;
  readonly type: string;
  readonly rawTarget: string;
  /** False when the target is not a safe sink (javascript:, file:, ...). Still not fetched. */
  readonly sinkSafe: boolean;
}

/**
 * A loaded package: every XML part as a canonical tree, plus the non-XML parts kept verbatim.
 *
 * The preservation model in one value. Modelled parts re-emit normalized; everything else is
 * byte-identical, which is why an unrecognized part never costs a document anything.
 */
export interface OoxmlPackage {
  /** Canonical trees, keyed by canonical part name. Non-XML parts are absent by design. */
  readonly parts: ReadonlyMap<string, OoxmlPart>;
  /** Raw bytes of every entry, including the non-XML parts that have no tree. */
  readonly partBytes: ReadonlyMap<string, Uint8Array>;
  /** Internal relationships by owner part, in authored order. */
  readonly relationships: ReadonlyMap<string, readonly RelationshipRecord[]>;
  readonly externalTargets: readonly OoxmlExternalTarget[];
  readonly contentTypes: ContentTypeIndex;
  /** Canonical name of the part the root `officeDocument` relationship points at. */
  readonly mainDocumentPart: string;
}

/** Why a package could not be loaded. Every code describes the FILE, not the caller. */
export type OoxmlPackageRejection =
  | ZipRejection
  | OoxmlReadRejection
  | 'no-content-types'
  | 'bad-content-types'
  | 'no-main-document'
  | 'bad-relationship-target'
  | 'duplicate-relationship-id'
  | 'too-many-relationships'
  | 'too-many-xml-parts';

/** A loaded package, or a typed refusal. Never throws. */
export type OoxmlPackageResult =
  | { readonly ok: true; readonly package: OoxmlPackage }
  | { readonly ok: false; readonly reason: OoxmlPackageRejection; readonly detail?: string };

function isElement(node: XmlNode): node is Extract<XmlNode, { type: 'element' }> {
  return node.type === 'element';
}

/**
 * Every element whose LOCAL name is `localName`, anywhere under `nodes`.
 *
 * Matching the local name rather than the authored QName is what makes this survive a
 * round trip: the canonical tree emits controlled prefixes, so a `<Relationship>` written
 * under a default namespace can legitimately reopen as `<ns0:Relationship>`. Comparing the
 * whole QName made the reader see zero relationships and reject its own output as having
 * no main document. Descending into children as well keeps a rels or types root wrapped in
 * unexpected structure from silently reading as empty.
 */
function collectElements(
  nodes: readonly XmlNode[],
  localName: string,
  out: Extract<XmlNode, { type: 'element' }>[] = []
): Extract<XmlNode, { type: 'element' }>[] {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    const colon = node.name.indexOf(':');
    if ((colon === -1 ? node.name : node.name.slice(colon + 1)) === localName) out.push(node);
    collectElements(node.children, localName, out);
  }
  return out;
}

/** An attribute value by LOCAL name, for the same prefix-independence reason. */
function attributeByLocalName(
  element: Extract<XmlNode, { type: 'element' }>,
  localName: string
): string | undefined {
  for (const [name, value] of Object.entries(element.attributes)) {
    const colon = name.indexOf(':');
    if ((colon === -1 ? name : name.slice(colon + 1)) === localName) return value;
  }
  return undefined;
}

function parseXmlQName(name: string): { readonly prefix: string; readonly localName: string } {
  const colon = name.indexOf(':');
  return colon === -1
    ? { prefix: '', localName: name }
    : { prefix: name.slice(0, colon), localName: name.slice(colon + 1) };
}

function xmlnsBindingsOf(
  attributes: Readonly<Record<string, string>>
): ReadonlyMap<string, string> {
  const bindings = new Map<string, string>();
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'xmlns') bindings.set('', value);
    else if (name.startsWith('xmlns:')) bindings.set(name.slice(6), value);
  }
  return bindings;
}

function mergeNamespaceScope(
  inherited: ReadonlyMap<string, string>,
  element: Extract<XmlNode, { type: 'element' }>
): ReadonlyMap<string, string> {
  const local = xmlnsBindingsOf(element.attributes);
  if (local.size === 0) return inherited;
  return new Map([...inherited, ...local]);
}

function elementNamespaceUri(
  element: Extract<XmlNode, { type: 'element' }>,
  scope: ReadonlyMap<string, string>
): string | undefined {
  return scope.get(parseXmlQName(element.name).prefix);
}

/** An unqualified attribute value — prefixed lookalikes are ignored for indexing. */
function unqualifiedXmlAttribute(
  element: Extract<XmlNode, { type: 'element' }>,
  localName: string
): string | undefined {
  for (const [name, value] of Object.entries(element.attributes)) {
    if (name.indexOf(':') !== -1) continue;
    if (name === localName) return value;
  }
  return undefined;
}

function collectContentTypeElements(
  nodes: readonly XmlNode[],
  localName: 'Default' | 'Override',
  inherited: ReadonlyMap<string, string>,
  out: Extract<XmlNode, { type: 'element' }>[] = []
): Extract<XmlNode, { type: 'element' }>[] {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    const scope = mergeNamespaceScope(inherited, node);
    const qname = parseXmlQName(node.name);
    if (
      qname.localName === localName &&
      elementNamespaceUri(node, scope) === CONTENT_TYPES_NAMESPACE
    ) {
      out.push(node);
    }
    collectContentTypeElements(node.children, localName, scope, out);
  }
  return out;
}

/**
 * The part a `.rels` part describes relationships FOR.
 * `/word/_rels/document.xml.rels` -> `/word/document.xml`; `/_rels/.rels` -> `/`.
 */
function relsOwner(relsPartName: string): string | null {
  const match = /^(.*)\/_rels\/([^/]*)\.rels$/.exec(relsPartName);
  if (!match) return null;
  const [, dir, base] = match;
  if (base === '') return '/'; // the package root rels
  return `${dir}/${base}`;
}

function readContentTypes(xml: string, limits?: XmlLimits): ContentTypeIndex | null {
  const parsed = readXml(xml, limits);
  if (!parsed.ok) return null;
  const defaults: DefaultRecord[] = [];
  const overrides: OverrideRecord[] = [];
  let order = 0;
  const emptyScope = new Map<string, string>();
  for (const element of collectContentTypeElements(parsed.nodes, 'Default', emptyScope)) {
    const extension = unqualifiedXmlAttribute(element, 'Extension');
    const contentType = unqualifiedXmlAttribute(element, 'ContentType');
    if (extension === undefined || contentType === undefined) continue;
    defaults.push({ extension, contentType, order: order++ });
  }
  for (const element of collectContentTypeElements(parsed.nodes, 'Override', emptyScope)) {
    const partName = unqualifiedXmlAttribute(element, 'PartName');
    const contentType = unqualifiedXmlAttribute(element, 'ContentType');
    if (partName === undefined || contentType === undefined) continue;
    overrides.push({ partName, contentType, order: order++ });
  }
  const index = buildContentTypeIndex({ defaults, overrides });
  return index.ok ? index.index : null;
}

/** Resolve a part's declared content type: Override wins, then the extension Default. */
function contentTypeFor(partName: string, index: ContentTypeIndex): string {
  const resolved = resolveContentType(index, partName);
  return resolved.ok ? resolved.contentType : '';
}

/**
 * Load an OPC package into canonical typed/generic OOXML trees.
 *
 * Fails closed on every limit, malformed name, unresolvable internal target, duplicate
 * relationship id, and XML rejection. An external relationship never causes a failure and
 * never causes a fetch: it is recorded with its sink-safety verdict for a later, explicitly
 * user-gated lane.
 */
/**
 * Load DOCX bytes into canonical trees, bounded at every step.
 *
 * THE trust boundary for a document. Composes the hardened primitives — zip limits and OPC name
 * normalization, content-type indexing, relationship validation, entity-free XML — into one
 * loader, and returns a typed rejection rather than throwing from inside a decoder.
 */
export function readOoxmlPackage(
  bytes: Uint8Array,
  limits: OoxmlPackageLimits = {}
): OoxmlPackageResult {
  const zip = readZip(bytes, limits.zip ?? DEFAULT_ZIP_LIMITS);
  if (!zip.ok) return { ok: false, reason: zip.reason, detail: zip.detail };

  const contentTypeBytes = zip.entries.get(CONTENT_TYPES_PART);
  if (!contentTypeBytes) return { ok: false, reason: 'no-content-types' };
  const decodedContentTypes = decodeXmlBytes(contentTypeBytes, limits.xml);
  if (!decodedContentTypes.ok) return { ok: false, reason: decodedContentTypes.reason };
  const contentTypes = readContentTypes(decodedContentTypes.xml, limits.xml);
  if (!contentTypes) return { ok: false, reason: 'bad-content-types' };

  const maxRelationships = limits.maxRelationships ?? DEFAULT_OOXML_PACKAGE_LIMITS.maxRelationships;
  const records: RelationshipRecord[] = [];
  const externalTargets: OoxmlExternalTarget[] = [];
  let order = 0;

  for (const [partName, data] of zip.entries) {
    const owner = relsOwner(partName);
    if (owner === null) continue;
    const decoded = decodeXmlBytes(data, limits.xml);
    if (!decoded.ok) return { ok: false, reason: decoded.reason, detail: partName };
    const parsed = readXml(decoded.xml, limits.xml);
    if (!parsed.ok) return { ok: false, reason: parsed.reason, detail: partName };
    for (const element of collectElements(parsed.nodes, 'Relationship')) {
      if (records.length >= maxRelationships) {
        return { ok: false, reason: 'too-many-relationships' };
      }
      const id = attributeByLocalName(element, 'Id');
      const type = attributeByLocalName(element, 'Type');
      const rawTarget = attributeByLocalName(element, 'Target');
      if (id === undefined || type === undefined || rawTarget === undefined) {
        return {
          ok: false,
          reason: 'bad-relationship-target',
          detail: `${partName}: missing attribute`,
        };
      }
      records.push({
        ownerPart: owner,
        id,
        type,
        rawTarget,
        targetMode:
          attributeByLocalName(element, 'TargetMode') === 'External' ? 'External' : 'Internal',
        order: order++,
      });
    }
  }

  const set = buildRelationshipSet(records);
  if (!set.ok) {
    return {
      ok: false,
      reason: 'duplicate-relationship-id',
      detail: `${set.error.ownerPart}: ${set.error.id}`,
    };
  }

  // Resolve every relationship BEFORE reading any part, so a traversing internal target
  // fails the load rather than being discovered halfway through building trees.
  for (const record of records) {
    const resolved = resolveRelationship(record);
    if (resolved.mode === 'External') {
      externalTargets.push({
        ownerPart: record.ownerPart,
        id: record.id,
        type: record.type,
        rawTarget: record.rawTarget,
        sinkSafe: resolved.sinkSafe.ok,
      });
      continue;
    }
    if (!resolved.target.ok) {
      return {
        ok: false,
        reason: 'bad-relationship-target',
        detail: `${record.ownerPart}/${record.id} -> ${record.rawTarget}: ${resolved.target.reason satisfies NameRejection}`,
      };
    }
  }

  const rootRels = set.byOwner.get('/') ?? [];
  const officeDocument = rootRels.find((record) => record.type === OFFICE_DOCUMENT_REL_TYPE);
  if (!officeDocument) return { ok: false, reason: 'no-main-document' };
  const mainResolved = resolveRelationship(officeDocument);
  if (mainResolved.mode !== 'Internal' || !mainResolved.target.ok) {
    return { ok: false, reason: 'no-main-document', detail: officeDocument.rawTarget };
  }
  const mainDocumentPart = mainResolved.target.partName;
  if (!zip.entries.has(mainDocumentPart)) {
    return { ok: false, reason: 'no-main-document', detail: mainDocumentPart };
  }

  const maxXmlParts = limits.maxXmlParts ?? DEFAULT_OOXML_PACKAGE_LIMITS.maxXmlParts;
  const parts = new Map<string, OoxmlPart>();
  for (const [partName, data] of zip.entries) {
    if (partName === CONTENT_TYPES_PART) continue;
    const contentType = contentTypeFor(partName, contentTypes);
    // Media SVG stays raw bytes — tree parsing would break D9 byte identity for parts.
    if (contentType.toLowerCase() === 'image/svg+xml') continue;
    if (!XML_CONTENT_TYPE_RE.test(contentType)) continue;
    if (parts.size >= maxXmlParts) return { ok: false, reason: 'too-many-xml-parts' };
    // Re-normalize even though `readZip` already did: this is the name that becomes a node
    // identity prefix, and it must not be reachable through a second, unchecked route.
    const normalized = normalizePartName(partName);
    if (!normalized.ok) {
      return {
        ok: false,
        reason: 'bad-relationship-target',
        detail: `${partName}: ${normalized.reason}`,
      };
    }
    const decoded = decodeXmlBytes(data, limits.xml);
    if (!decoded.ok) return { ok: false, reason: decoded.reason, detail: partName };
    const read = readOoxmlPart(decoded.xml, { name: normalized.partName, contentType }, limits.xml);
    if (!read.ok) return { ok: false, reason: read.reason, detail: partName };
    parts.set(normalized.partName, read.part);
  }

  return {
    ok: true,
    package: Object.freeze({
      parts,
      partBytes: zip.entries,
      relationships: set.byOwner,
      externalTargets: Object.freeze(externalTargets),
      contentTypes,
      mainDocumentPart,
    }),
  };
}

/**
 * Serialize a canonical package back to DOCX bytes.
 *
 * Starts from the ORIGINAL entry bytes and overwrites only the parts held as trees. A part
 * the loader did not model — media, fonts, an XML part outside the modeled set — passes
 * through untouched, so round-tripping a document cannot lose a part the engine never
 * claimed to understand.
 *
 * The modeled parts are re-emitted NORMALIZED from the tree rather than patched as text.
 * That is the whole point of the canonical tree: correctness is judged by the two D9
 * oracles (the namespace-aware fingerprint and the save/reopen semantic digest), not by
 * byte equality, so a different-but-equivalent spelling is not a defect.
 *
 * `writeZip` re-validates every part name, so a name that became unsafe between load and
 * save cannot be smuggled into the archive.
 */
export function writeOoxmlPackage(pkg: OoxmlPackage): Uint8Array {
  const entries = new Map<string, Uint8Array>(pkg.partBytes);
  for (const [name, part] of pkg.parts) {
    entries.set(name, strToU8(serializeOoxmlPart(part)));
  }
  return writeZip(entries);
}

/** Replace one part's tree, returning a new package. Pure, like the tree edits themselves. */
export function withPart(pkg: OoxmlPackage, part: OoxmlPart): OoxmlPackage {
  return Object.freeze({ ...pkg, parts: new Map([...pkg.parts, [part.name, part]]) });
}

export {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  DEFAULT_SUPPORTED_MC_REQUIRES,
  drawingAccessibility,
  projectDrawing,
  projectDrawingsInPackage,
  projectDrawingsInPart,
  type DrawingAccessibility,
  type DrawingDiagnostic,
  type DrawingKind,
  type DrawingProjection,
  type DrawingProjectionLimits,
  type ImageWrapTarget,
} from './drawing-projection.ts';
export {
  createImageResourceCache,
  imageResourceLookupFor,
  liveDrawingReferenceCount,
  sniffImageMime,
  type ImageDecodePort,
  type ImageResourceLookup,
  type ImageResourceState,
  type SupportedImageMime,
} from './image-resources.ts';
export {
  allocateDrawingPropertyId,
  withBinaryPart,
  withEmbeddedImage,
  withoutUnreferencedImagePart,
  type DrawingPropertyIdResult,
} from './drawing-package-edit.ts';

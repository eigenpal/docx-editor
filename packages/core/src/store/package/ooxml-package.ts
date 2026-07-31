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
import { readXml, type XmlLimits, type XmlNode } from './xml-reader.ts';
import { normalizePartName, type NameRejection } from './opc-names.ts';
import {
  buildRelationshipSet,
  resolveRelationship,
  type RelationshipRecord,
} from './relationships.ts';
import {
  buildContentTypeIndex,
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
const OFFICE_DOCUMENT_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/** MIME types read into canonical trees. Anything else stays bytes (media, fonts, ...). */
const XML_CONTENT_TYPE_RE = /(?:\/xml|\+xml)$/i;

export interface OoxmlPackageLimits {
  readonly zip?: ZipLimits;
  readonly xml?: XmlLimits;
  /** Cap on parts converted into canonical trees (N/N+1 gate, not a soft target). */
  readonly maxXmlParts?: number;
  /** Cap on relationship records across every rels part. */
  readonly maxRelationships?: number;
}

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
  for (const element of collectElements(parsed.nodes, 'Default')) {
    const extension = attributeByLocalName(element, 'Extension');
    const contentType = attributeByLocalName(element, 'ContentType');
    if (extension === undefined || contentType === undefined) return null;
    defaults.push({ extension, contentType, order: order++ });
  }
  for (const element of collectElements(parsed.nodes, 'Override')) {
    const partName = attributeByLocalName(element, 'PartName');
    const contentType = attributeByLocalName(element, 'ContentType');
    if (partName === undefined || contentType === undefined) return null;
    overrides.push({ partName, contentType, order: order++ });
  }
  const index = buildContentTypeIndex({ defaults, overrides });
  return index.ok ? index.index : null;
}

/** Resolve a part's declared content type: Override wins, then the extension Default. */
function contentTypeFor(partName: string, index: ContentTypeIndex): string {
  const override = index.overrides.get(partName.toLowerCase());
  if (override !== undefined) return override;
  const dot = partName.lastIndexOf('.');
  if (dot === -1) return '';
  return index.defaults.get(partName.slice(dot + 1).toLowerCase()) ?? '';
}

/**
 * Load an OPC package into canonical typed/generic OOXML trees.
 *
 * Fails closed on every limit, malformed name, unresolvable internal target, duplicate
 * relationship id, and XML rejection. An external relationship never causes a failure and
 * never causes a fetch: it is recorded with its sink-safety verdict for a later, explicitly
 * user-gated lane.
 */
export function readOoxmlPackage(
  bytes: Uint8Array,
  limits: OoxmlPackageLimits = {}
): OoxmlPackageResult {
  const zip = readZip(bytes, limits.zip ?? DEFAULT_ZIP_LIMITS);
  if (!zip.ok) return { ok: false, reason: zip.reason, detail: zip.detail };

  const contentTypeBytes = zip.entries.get(CONTENT_TYPES_PART);
  if (!contentTypeBytes) return { ok: false, reason: 'no-content-types' };
  const contentTypes = readContentTypes(strFromU8(contentTypeBytes), limits.xml);
  if (!contentTypes) return { ok: false, reason: 'bad-content-types' };

  const maxRelationships = limits.maxRelationships ?? DEFAULT_OOXML_PACKAGE_LIMITS.maxRelationships;
  const records: RelationshipRecord[] = [];
  const externalTargets: OoxmlExternalTarget[] = [];
  let order = 0;

  for (const [partName, data] of zip.entries) {
    const owner = relsOwner(partName);
    if (owner === null) continue;
    const parsed = readXml(strFromU8(data), limits.xml);
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
    const read = readOoxmlPart(
      strFromU8(data),
      { name: normalized.partName, contentType },
      limits.xml
    );
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

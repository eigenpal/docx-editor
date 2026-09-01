/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import type { CanonicalBinaryDescriptor } from '@docx-editor.dev/core/collaboration/replication';
import { rejectDangerousKey, rejectString } from './limits.ts';
import type { LogicalId } from './identity.ts';

export const PACKAGE_PROTOCOL_VERSION = 1;
export const PACKAGE_SHARED_SCHEMA_VERSION = 2;
export const PACKAGE_REPAIR_VERSION = 1;
export const PACKAGE_CANONICAL_MODEL_VERSION = 1;

export const PACKAGE_META_KEY = 'docx-package-meta-v1';
export const PACKAGE_NODES_KEY = 'docx-package-nodes-v1';
export const PACKAGE_PARTS_KEY = 'docx-package-parts-v1';
export const PACKAGE_RELS_KEY = 'docx-package-rels-v1';
export const PACKAGE_OVERRIDES_KEY = 'docx-package-overrides-v1';
export const PACKAGE_DEFAULTS_KEY = 'docx-package-defaults-v1';
export const PACKAGE_BINARIES_KEY = 'docx-package-binaries-v1';
export const PACKAGE_NAMESPACES_KEY = 'docx-package-namespaces-v1';
export const PACKAGE_ATTRIBUTES_KEY = 'docx-package-attributes-v1';
export const PACKAGE_BINDINGS_KEY = 'docx-package-bindings-v1';

export const NODE_SHELL_FIELD = 's';
export const NODE_TEXT_FIELD = 't';
export const NODE_CHILDREN_FIELD = 'children';
export const NODE_DELETED_FIELD = 'deleted';
export const NODE_REPLACED_BY_FIELD = 'replacedBy';
/**
 * The run this run was split off from — the original run id a format split superseded.
 *
 * Written once by the peer that minted the run, so two peers splitting the same original
 * concurrently write it on their OWN (different) run records, never racing one shared
 * container. Both carry the same origin id, so materialize can group the concurrent splits
 * and keep one replica's runs deterministically, dropping the duplicated text (#581).
 * Internal shared state, never serialized to the `.docx`.
 */
export const NODE_SPLIT_FROM_FIELD = 'splitFrom';
/** Source text when a run split, used to rebase a concurrent text edit onto its products. */
export const NODE_SPLIT_BASE_TEXT_FIELD = 'splitBaseText';
/** UTF-16 start of one split product in {@link NODE_SPLIT_BASE_TEXT_FIELD}. */
export const NODE_SPLIT_START_FIELD = 'splitStart';

/** Unit separator. XML names and NCName prefixes cannot hold this character. */
export const FIELD_SEP = '\u001f';

export const EMPTY_NAMESPACE_ID = '-';

export const BOOTSTRAP_ORIGIN = Object.freeze({ kind: 'docx-package-bootstrap' });
export const JOURNAL_ORIGIN = Object.freeze({ kind: 'docx-package-journal' });

export interface PackageSchemaVersions {
  readonly protocolVersion: number;
  readonly sharedSchemaVersion: number;
  readonly repairVersion: number;
  readonly canonicalModelVersion: number;
}

export const PACKAGE_SCHEMA_VERSIONS: PackageSchemaVersions = Object.freeze({
  protocolVersion: PACKAGE_PROTOCOL_VERSION,
  sharedSchemaVersion: PACKAGE_SHARED_SCHEMA_VERSION,
  repairVersion: PACKAGE_REPAIR_VERSION,
  canonicalModelVersion: PACKAGE_CANONICAL_MODEL_VERSION,
});

export interface EncodedAttribute {
  readonly namespaceUri: string;
  readonly localName: string;
  readonly prefix?: string;
  readonly value: string;
}

export interface EncodedBinding {
  readonly prefix: string;
  readonly namespaceUri: string;
}

export interface ElementRecord {
  readonly logicalId: LogicalId;
  readonly kind: string;
  readonly namespaceUri: string;
  readonly localName: string;
  readonly prefix?: string;
  readonly attributes: readonly EncodedAttribute[];
  readonly bindings: readonly EncodedBinding[];
  readonly childIds: readonly LogicalId[];
}

export interface TextRecord {
  readonly logicalId: LogicalId;
  readonly kind: 'textValue';
  readonly value: string;
}

export type SharedRecord = ElementRecord | TextRecord;

export function isTextRecord(record: SharedRecord): record is TextRecord {
  return record.kind === 'textValue';
}

export function isElementRecord(record: SharedRecord): record is ElementRecord {
  return !isTextRecord(record);
}

export interface PartDirectoryEntry {
  readonly name: string;
  readonly id: string;
  readonly rootLogicalId: LogicalId;
  readonly contentType: string;
}

export interface EncodedRelationship {
  readonly ownerPart: string;
  readonly id: string;
  readonly type: string;
  readonly rawTarget: string;
  readonly targetMode: 'Internal' | 'External';
  readonly order: number;
}

export type RepairIssueCode =
  | 'duplicate-parent'
  | 'duplicate-child'
  | 'cycle'
  | 'self-child'
  | 'missing-node'
  | 'child-id-not-in-registry'
  | 'deleted-referenced'
  | 'orphan'
  | 'orphan-with-content';

export interface RepairIssue {
  readonly code: RepairIssueCode;
  readonly logicalId?: LogicalId;
}

/**
 * Repair codes that mean shared state held content the materialized package does not.
 *
 * The rest of {@link RepairIssueCode} describes structure the materializer can drop without
 * losing anything a reader could have seen: `self-child`, `duplicate-child` and
 * `duplicate-parent` name a placement that was never possible in a tree, and a plain `orphan`
 * has no text, no children and no attributes. Those repair silently, which is correct.
 *
 * Three codes are deliberately absent, all because they are what healthy editing looks like:
 *
 * - `deleted-referenced` — a parent that still lists a tombstoned child is the ordinary shape
 *   of a concurrent delete, since the tombstone lands before the author's new child list
 *   reaches every replica.
 * - `orphan-with-content` — deleting a run unlinks it and leaves the record behind, so its text
 *   is unreferenced content by design. Measured, not assumed: including this code took every
 *   delete in `document-session.test.ts` to `error`, which stopped the remote apply and left
 *   the deletion unreplicated. A status that fires on every delete tells a reader nothing.
 * - `duplicate-parent` — two child arrays list one node because two peers relocated it, which
 *   is what `splitParagraph` and a paste do to every run after the caret. Each replica can only
 *   unlist the parent it saw, so the merged listing names both. The materializer answers it the
 *   one deterministic way — first preorder placement wins — and every replica walks the same
 *   shared state, so every replica reaches the same tree. Nothing leaves the document: the
 *   node is placed exactly once, and no tree could have held it twice. What the losing parent
 *   loses is a PLACEMENT, not content, and it is left as an empty element.
 *
 *   Measured, not assumed: escalating it stopped the remote apply on BOTH peers, so each kept
 *   its own local edit, the status stuck at `error`, and `gateOperations` refused every later
 *   keystroke. Two people pressing Enter in one paragraph took the room read-only and
 *   permanently split-brained — see `document-concurrent-relocation.test.ts`. The report itself
 *   stays in {@link RepairIssue}, so a caller that wants to count contests still can.
 *
 * The consequence is that the one loss shape which presents AS an orphan — content stranded by
 * a concurrent first-create of a part — is still not reported. Separating that from a deleted
 * run needs the tombstone to say which it was, so it waits on the same work as D15.
 *
 * What remains cannot arise from healthy editing: each one means a parent names a child this
 * replica cannot produce, so the document is short of something shared state says is there.
 */
export const DROPPED_CONTENT_REPAIR_CODES: ReadonlySet<RepairIssueCode> = Object.freeze(
  new Set<RepairIssueCode>(['missing-node', 'child-id-not-in-registry', 'cycle'])
);

/** Longest detail string built from an issue list. Enough for every distinct code twice over. */
const MAX_DROPPED_DETAIL_LENGTH = 200;

/**
 * Summarize the dropped-content issues in `issues`, or `null` when there are none.
 *
 * Counts by code rather than listing logical ids: an id means nothing to a reader, and one
 * malformed subtree can produce thousands of them.
 */
export function droppedContentDetail(issues: readonly RepairIssue[]): string | null {
  const counts = new Map<RepairIssueCode, number>();
  for (const issue of issues) {
    if (!DROPPED_CONTENT_REPAIR_CODES.has(issue.code)) continue;
    counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([code, count]) => `${code}=${count}`)
    .join(',')
    .slice(0, MAX_DROPPED_DETAIL_LENGTH);
}

export interface DirtyPaths {
  readonly logicalIds: ReadonlySet<LogicalId>;
  readonly membershipChanged: boolean;
  readonly packageChanged: boolean;
}

export interface UnpackedNodeShell {
  readonly kind: string;
  readonly namespaceId: string;
  readonly localName: string;
  readonly prefix: string;
}

export interface PackageSchema {
  readonly meta: Y.Map<unknown>;
  readonly nodes: Y.Map<Y.Map<unknown>>;
  readonly parts: Y.Map<Y.Map<unknown>>;
  readonly relationships: Y.Map<Y.Map<Y.Map<unknown>>>;
  readonly overrides: Y.Map<string>;
  readonly defaults: Y.Map<string>;
  readonly binaries: Y.Map<Y.Map<unknown>>;
  readonly namespaces: Y.Map<string>;
  readonly attributes: Y.Map<string>;
  readonly bindings: Y.Map<string>;
}

export function packageSchemaOf(doc: Y.Doc): PackageSchema {
  return {
    meta: doc.getMap(PACKAGE_META_KEY),
    nodes: doc.getMap(PACKAGE_NODES_KEY),
    parts: doc.getMap(PACKAGE_PARTS_KEY),
    relationships: doc.getMap(PACKAGE_RELS_KEY),
    overrides: doc.getMap(PACKAGE_OVERRIDES_KEY),
    defaults: doc.getMap(PACKAGE_DEFAULTS_KEY),
    binaries: doc.getMap(PACKAGE_BINARIES_KEY),
    namespaces: doc.getMap(PACKAGE_NAMESPACES_KEY),
    attributes: doc.getMap(PACKAGE_ATTRIBUTES_KEY),
    bindings: doc.getMap(PACKAGE_BINDINGS_KEY),
  };
}

/**
 * Well-known OOXML namespace URIs map to short ids.
 *
 * The id is a function of the URI string, not a replica-local counter. Two replicas that
 * intern the same URI write the same map key and the same value, so the writes converge.
 */
const WELL_KNOWN_NAMESPACES: readonly (readonly [string, string])[] = [
  ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'r'],
  ['http://schemas.openxmlformats.org/package/2006/relationships', 'pr'],
  ['http://schemas.openxmlformats.org/package/2006/content-types', 'ct'],
  ['http://www.w3.org/XML/1998/namespace', 'xml'],
  ['http://www.w3.org/2000/xmlns/', 'xmlns'],
  ['http://schemas.openxmlformats.org/drawingml/2006/main', 'a'],
  ['http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'wp'],
  ['http://schemas.openxmlformats.org/drawingml/2006/picture', 'pic'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/math', 'm'],
  ['http://schemas.openxmlformats.org/markup-compatibility/2006', 'mc'],
  ['http://schemas.microsoft.com/office/word/2010/wordml', 'w14'],
  ['http://schemas.microsoft.com/office/word/2012/wordml', 'w15'],
  ['http://schemas.microsoft.com/office/word/2015/wordml/symex', 'w16se'],
  ['http://schemas.microsoft.com/office/word/2016/wordml/cid', 'w16cid'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', 'od'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/extended-properties', 'ep'],
  ['http://schemas.openxmlformats.org/package/2006/metadata/core-properties', 'cp'],
  ['http://purl.org/dc/elements/1.1/', 'dc'],
  ['http://purl.org/dc/terms/', 'dcterms'],
  ['http://www.w3.org/2001/XMLSchema-instance', 'xsi'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes', 'vt'],
  ['http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas', 'wpc'],
  ['http://schemas.microsoft.com/office/word/2010/wordprocessingGroup', 'wpg'],
  ['http://schemas.microsoft.com/office/word/2010/wordprocessingInk', 'wpi'],
  ['http://schemas.microsoft.com/office/word/2010/wordprocessingShape', 'wps'],
  ['http://schemas.openxmlformats.org/drawingml/2006/chart', 'c'],
  ['http://schemas.openxmlformats.org/schemaLibrary/2006/main', 'sl'],
];

const WELL_KNOWN_ID_BY_URI = new Map(WELL_KNOWN_NAMESPACES);
const WELL_KNOWN_URI_BY_ID = new Map(WELL_KNOWN_NAMESPACES.map(([uri, id]) => [id, uri] as const));

function fnv1a64Hex(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Content-derived namespace id. The same URI always yields the same id. */
export function namespaceIdOf(uri: string): string {
  if (uri.length === 0) return EMPTY_NAMESPACE_ID;
  return WELL_KNOWN_ID_BY_URI.get(uri) ?? `n${fnv1a64Hex(uri)}`;
}

export function internNamespace(
  namespaces: Y.Map<string>,
  uri: string,
  maxStringLength: number
): string {
  const id = namespaceIdOf(uri);
  if (uri.length === 0) return id;
  if (rejectDangerousKey(id) || rejectString(uri, maxStringLength)) return id;
  if (namespaces.get(id) !== uri) namespaces.set(id, uri);
  return id;
}

export function namespaceUriOf(namespaces: Y.Map<string>, id: string): string {
  if (id === EMPTY_NAMESPACE_ID || rejectDangerousKey(id)) return '';
  const stored = namespaces.get(id);
  if (typeof stored === 'string') return stored;
  return WELL_KNOWN_URI_BY_ID.get(id) ?? '';
}

export function packNodeShell(
  kind: string,
  namespaceId: string,
  localName: string,
  prefix: string
): string {
  return `${kind}${FIELD_SEP}${namespaceId}${FIELD_SEP}${localName}${FIELD_SEP}${prefix}`;
}

export function unpackNodeShell(packed: string): UnpackedNodeShell {
  const parts = packed.split(FIELD_SEP);
  return {
    kind: parts[0] || 'generic',
    namespaceId: parts[1] ?? '',
    localName: parts[2] ?? '',
    prefix: parts[3] ?? '',
  };
}

export function attributeMapKey(logicalId: string, namespaceId: string, localName: string): string {
  return `${logicalId}${FIELD_SEP}${namespaceId}${FIELD_SEP}${localName}`;
}

export function parseAttributeMapKey(
  key: string
): { readonly logicalId: string; readonly namespaceId: string; readonly localName: string } | null {
  const parts = key.split(FIELD_SEP);
  if (parts.length !== 3) return null;
  const logicalId = parts[0]!;
  const namespaceId = parts[1]!;
  const localName = parts[2]!;
  if (logicalId.length === 0 || localName.length === 0) return null;
  return { logicalId, namespaceId, localName };
}

export function bindingMapKey(logicalId: string, prefix: string): string {
  return `${logicalId}${FIELD_SEP}${prefix}`;
}

export function parseBindingMapKey(
  key: string
): { readonly logicalId: string; readonly prefix: string } | null {
  const parts = key.split(FIELD_SEP);
  if (parts.length !== 2) return null;
  const logicalId = parts[0]!;
  const prefix = parts[1]!;
  if (logicalId.length === 0) return null;
  return { logicalId, prefix };
}

export function packAttributeValue(prefix: string, value: string): string {
  return `${prefix}${FIELD_SEP}${value}`;
}

export function unpackAttributeValue(packed: string): {
  readonly prefix: string;
  readonly value: string;
} {
  const split = packed.indexOf(FIELD_SEP);
  if (split < 0) return { prefix: '', value: packed };
  return { prefix: packed.slice(0, split), value: packed.slice(split + 1) };
}

export function makeElementRecord(
  record: Omit<ElementRecord, 'childIds' | 'attributes' | 'bindings'> & {
    readonly namespaceId: string;
    readonly childIds?: readonly LogicalId[];
  }
): Y.Map<unknown> {
  const rec = new Y.Map<unknown>();
  rec.set(
    NODE_SHELL_FIELD,
    packNodeShell(record.kind, record.namespaceId, record.localName, record.prefix ?? '')
  );
  const children = new Y.Array<string>();
  if (record.childIds && record.childIds.length > 0) children.push([...record.childIds]);
  rec.set(NODE_CHILDREN_FIELD, children);
  return rec;
}

export function makeTextRecord(value: string): Y.Map<unknown> {
  const rec = new Y.Map<unknown>();
  rec.set(NODE_TEXT_FIELD, new Y.Text(value));
  return rec;
}

export function makePartEntry(
  id: string,
  rootLogicalId: LogicalId,
  contentType: string
): Y.Map<unknown> {
  const rec = new Y.Map<unknown>();
  rec.set('id', id);
  rec.set('rootId', rootLogicalId);
  rec.set('contentType', contentType);
  return rec;
}

export function makeRelationshipEntry(record: EncodedRelationship): Y.Map<unknown> {
  const rec = new Y.Map<unknown>();
  rec.set('ownerPart', record.ownerPart);
  rec.set('id', record.id);
  rec.set('type', record.type);
  rec.set('rawTarget', record.rawTarget);
  rec.set('targetMode', record.targetMode);
  rec.set('order', record.order);
  return rec;
}

export function makeBinaryEntry(descriptor: CanonicalBinaryDescriptor): Y.Map<unknown> {
  const rec = new Y.Map<unknown>();
  rec.set('digest', descriptor.digest);
  rec.set('size', descriptor.size);
  rec.set('mediaType', descriptor.mediaType);
  rec.set('storageKey', descriptor.storageKey);
  return rec;
}

export function writeSchemaVersions(meta: Y.Map<unknown>): void {
  meta.set('protocolVersion', PACKAGE_PROTOCOL_VERSION);
  meta.set('sharedSchemaVersion', PACKAGE_SHARED_SCHEMA_VERSION);
  meta.set('repairVersion', PACKAGE_REPAIR_VERSION);
  meta.set('canonicalModelVersion', PACKAGE_CANONICAL_MODEL_VERSION);
  meta.set('initialized', true);
}

export function isNodeMap(value: unknown): value is Y.Map<unknown> {
  return value instanceof Y.Map;
}

// The nodes map is peer-writable, so a value read from it is attacker-controlled: a hostile
// update can plant a scalar where a record belongs. Every reader below takes `unknown` and
// treats a non-map as "no such node", so a crafted shape degrades to an absent node rather
// than crashing the observer or the materializer mid-`applyUpdate`.

export function childArrayOf(record: unknown): Y.Array<string> | null {
  if (!isNodeMap(record)) return null;
  const children = record.get(NODE_CHILDREN_FIELD);
  return children instanceof Y.Array ? children : null;
}

export function isTextNodeMap(record: unknown): boolean {
  return isNodeMap(record) && record.get(NODE_TEXT_FIELD) instanceof Y.Text;
}

/** True only when `record` is a node map flagged tombstoned. A non-map reads as not-a-node. */
export function nodeRecordTombstoned(record: unknown): boolean {
  return isNodeMap(record) && record.get(NODE_DELETED_FIELD) === true;
}

/** The survivor a tombstone names, or null when `record` is not a node map or names none. */
export function nodeRecordReplacedBy(record: unknown): string | null {
  if (!isNodeMap(record)) return null;
  const value = record.get(NODE_REPLACED_BY_FIELD);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The original run a split produced this one from, guarded against peer-planted shapes. */
export function nodeRecordSplitFrom(record: unknown): string | null {
  if (!isNodeMap(record)) return null;
  const value = record.get(NODE_SPLIT_FROM_FIELD);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function nodeRecordSplitBaseText(record: unknown): string | null {
  if (!isNodeMap(record)) return null;
  const value = record.get(NODE_SPLIT_BASE_TEXT_FIELD);
  return typeof value === 'string' ? value : null;
}

export function nodeRecordSplitStart(record: unknown): number | null {
  if (!isNodeMap(record)) return null;
  const value = record.get(NODE_SPLIT_START_FIELD);
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { OoxmlInvariantIssueCode, OoxmlPart } from '@docx-editor.dev/core/store';
import type * as Y from 'yjs';

/** Shared-representation candidate under test. */
export type BackendKind = 'xml' | 'registry';

/** Replicated logical identity. Never a Yjs item id or a Word-facing id. */
export type LogicalId = string;

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

export interface PartIdentity {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
}

export interface DirtyPaths {
  readonly logicalIds: ReadonlySet<LogicalId>;
  readonly backend: BackendKind;
  readonly membershipChanged?: boolean;
}

export interface NodeIdentityMeta {
  readonly logicalId: LogicalId;
  readonly yjsItemKey: string | null;
  readonly wordFacingIds: readonly string[];
}

export interface ByteSizes {
  readonly updateBytes: number;
  readonly snapshotBytes: number;
}

/**
 * Spike merge/repair issue codes. Canonical tree codes stay
 * `OoxmlInvariantIssueCode`. These extra codes describe shared-state problems.
 */
export type SpikeIssueCode =
  | 'lost-concurrent-descendant-edit'
  | 'lost-logical-identity'
  | 'duplicate-parent'
  | 'duplicate-parent-reference'
  | 'duplicate-child'
  | 'cycle'
  | 'missing-node'
  | 'missing-node-record'
  | 'child-id-not-in-registry'
  | 'deleted-referenced'
  | 'orphan'
  | 'orphan-with-content'
  | 'orphaned-edit-after-delete'
  | 'replaced-by-missing'
  | 'self-child'
  | 'text-divergence';

export type InvariantIssueCode = OoxmlInvariantIssueCode | SpikeIssueCode;

export type GateVerdict = 'pass' | 'optimize' | 'kill';

export interface MoveGateEvidence {
  readonly backend: BackendKind;
  readonly logicalIdSurvived: boolean;
  readonly descendantEditSurvived: boolean;
  readonly verdict: GateVerdict;
}

export interface AllocationGateEvidence {
  readonly backend: BackendKind;
  readonly localAllocated: number;
  readonly remoteAllocated: number;
  readonly ratio: number;
  readonly verdict: GateVerdict;
}

/** One bounded backend over one `Y.Doc`. No provider. */
export interface RepresentationBackend {
  readonly kind: BackendKind;
  readonly doc: Y.Doc;
  seed(part: OoxmlPart): void;
  beginBulkLoad(): void;
  endBulkLoad(): void;
  partIdentity(): PartIdentity;
  rootLogicalId(): LogicalId;
  record(logicalId: LogicalId): SharedRecord | null;
  parentOf(logicalId: LogicalId): LogicalId | null;
  identityMeta(logicalId: LogicalId): NodeIdentityMeta | null;
  insertText(logicalId: LogicalId, offset: number, text: string): void;
  deleteText(logicalId: LogicalId, offset: number, length: number): void;
  setAttribute(logicalId: LogicalId, attribute: EncodedAttribute): void;
  removeAttribute(logicalId: LogicalId, namespaceUri: string, localName: string): void;
  createElement(record: Omit<ElementRecord, 'childIds'>): void;
  createText(logicalId: LogicalId, value: string): void;
  spliceChildren(
    parentId: LogicalId,
    index: number,
    deleteCount: number,
    insertIds: readonly LogicalId[]
  ): void;
  moveNode(nodeId: LogicalId, destParentId: LogicalId, destIndex: number): void;
  tombstone(logicalId: LogicalId): void;
  joinNodes(survivorId: LogicalId, removedId: LogicalId): void;
  isTombstoned(logicalId: LogicalId): boolean;
  replacedByOf(logicalId: LogicalId): LogicalId | null;
  adoptedChildren(survivorId: LogicalId): readonly LogicalId[];
  listingParents(logicalId: LogicalId): readonly LogicalId[];
  allLogicalIds(): readonly LogicalId[];
  trackedTypes(): readonly Y.AbstractType<unknown>[];
  observeDirty(onDirty: (paths: DirtyPaths) => void): () => void;
  encodeSnapshot(): Uint8Array;
  encodeUpdate(remoteStateVector: Uint8Array): Uint8Array;
}

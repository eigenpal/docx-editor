/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';

export const PROTOCOL_VERSION = 1;
export const SHARED_SCHEMA_VERSION = 1;
export const REPAIR_VERSION = 1;
export const CANONICAL_MODEL_VERSION = 1;
export const BODY_KEY = 'body';
export const META_KEY = 'generation-spike-meta';

export interface SchemaVersions {
  readonly protocolVersion: number;
  readonly sharedSchemaVersion: number;
  readonly repairVersion: number;
  readonly canonicalModelVersion: number;
}

export const SUPPORTED_SCHEMA: SchemaVersions = {
  protocolVersion: PROTOCOL_VERSION,
  sharedSchemaVersion: SHARED_SCHEMA_VERSION,
  repairVersion: REPAIR_VERSION,
  canonicalModelVersion: CANONICAL_MODEL_VERSION,
};

export interface Checkpoint {
  readonly checkpointId: string;
  readonly roomGenerationId: string;
  readonly schema: SchemaVersions;
  readonly state: Uint8Array;
  readonly stateVector: Uint8Array;
  readonly lastValidCanonicalIdentity: string;
  readonly requiredBlobs: readonly string[];
}

export interface ResetSnapshot {
  readonly text: string;
  readonly schema?: SchemaVersions;
  readonly requiredBlobs?: readonly string[];
}

export interface UpdateFrame {
  readonly roomGenerationId: string;
  readonly sessionId: string;
  readonly update: Uint8Array;
}

export interface SessionRecord {
  readonly sessionId: string;
  readonly roomGenerationId: string;
  readonly clientId: number;
  connected: boolean;
  disconnectReason: string | null;
}

export type AuditKind =
  | 'checkpoint'
  | 'restore'
  | 'destructive-reset'
  | 'rollback'
  | 'migration'
  | 'reject-stale'
  | 'discard-candidate';

export interface AuditFact {
  readonly kind: AuditKind;
  readonly roomGenerationId: string;
  readonly previousGenerationId?: string;
  readonly checkpointId?: string;
  readonly code?: string;
}

export type FailureCode =
  | 'stale-generation'
  | 'disconnected'
  | 'writers-locked'
  | 'unknown-session'
  | 'unknown-checkpoint'
  | 'unknown-generation'
  | 'cas-mismatch'
  | 'missing-blob'
  | 'invalid-schema'
  | 'empty-canonical-identity'
  | 'unsupported-version'
  | 'invalid-snapshot';

export interface GenerationRecord {
  readonly roomGenerationId: string;
  readonly sequence: number;
  readonly doc: Y.Doc;
  readonly schema: SchemaVersions;
  lastValidCanonicalIdentity: string;
  requiredBlobs: readonly string[];
}

export function cloneBytes(bytes: Uint8Array): Uint8Array {
  return bytes.slice();
}

export function blobDigest(bytes: Uint8Array): string {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `blob-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function canonicalIdentity(text: string, blobs: readonly string[]): string {
  return `canon:${text}:${blobs.join(',')}`;
}

export function schemaOf(doc: Y.Doc): {
  readonly meta: Y.Map<unknown>;
  readonly body: Y.Text;
} {
  return {
    meta: doc.getMap(META_KEY),
    body: doc.getText(BODY_KEY),
  };
}

export function readSchema(meta: Y.Map<unknown>): SchemaVersions | null {
  const protocolVersion = meta.get('protocolVersion');
  const sharedSchemaVersion = meta.get('sharedSchemaVersion');
  const repairVersion = meta.get('repairVersion');
  const canonicalModelVersion = meta.get('canonicalModelVersion');
  if (
    ![protocolVersion, sharedSchemaVersion, repairVersion, canonicalModelVersion].every(
      (value) => typeof value === 'number' && Number.isSafeInteger(value)
    )
  ) {
    return null;
  }
  return {
    protocolVersion: protocolVersion as number,
    sharedSchemaVersion: sharedSchemaVersion as number,
    repairVersion: repairVersion as number,
    canonicalModelVersion: canonicalModelVersion as number,
  };
}

export function writeSchema(meta: Y.Map<unknown>, schema: SchemaVersions): void {
  meta.set('protocolVersion', schema.protocolVersion);
  meta.set('sharedSchemaVersion', schema.sharedSchemaVersion);
  meta.set('repairVersion', schema.repairVersion);
  meta.set('canonicalModelVersion', schema.canonicalModelVersion);
}

export function compareAndSwapActive(
  current: string | null,
  expected: string,
  next: string
): { ok: true; active: string } | { ok: false; active: string | null; code: 'cas-mismatch' } {
  if (current !== expected) return { ok: false, active: current, code: 'cas-mismatch' };
  return { ok: true, active: next };
}

export function schemaEquals(left: SchemaVersions, right: SchemaVersions): boolean {
  return (
    left.protocolVersion === right.protocolVersion &&
    left.sharedSchemaVersion === right.sharedSchemaVersion &&
    left.repairVersion === right.repairVersion &&
    left.canonicalModelVersion === right.canonicalModelVersion
  );
}

export function encodeCheckpoint(generation: GenerationRecord, checkpointId: string): Checkpoint {
  return {
    checkpointId,
    roomGenerationId: generation.roomGenerationId,
    schema: generation.schema,
    state: cloneBytes(Y.encodeStateAsUpdate(generation.doc)),
    stateVector: cloneBytes(Y.encodeStateVector(generation.doc)),
    lastValidCanonicalIdentity: generation.lastValidCanonicalIdentity,
    requiredBlobs: [...generation.requiredBlobs],
  };
}

export function loadCheckpointDoc(checkpoint: Checkpoint): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, checkpoint.state, 'checkpoint');
  return doc;
}

export function recoverProcess(
  checkpoint: Checkpoint,
  laterUpdates: readonly Uint8Array[]
): { readonly doc: Y.Doc; readonly text: string; readonly roomGenerationId: string } {
  const doc = loadCheckpointDoc(checkpoint);
  for (const update of laterUpdates) Y.applyUpdate(doc, update, 'later-update');
  return {
    doc,
    text: doc.getText(BODY_KEY).toString(),
    roomGenerationId: checkpoint.roomGenerationId,
  };
}

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { CollaborationSchemaError } from './schema.ts';

/** Version contract for full-document collaboration clients and export workers. @public */
export interface DocumentCollaborationVersions {
  /** Transport-level interpretation of the shared package. */
  readonly protocolVersion: number;
  /** Shared node and character representation. */
  readonly sharedSchemaVersion: number;
  /** Deterministic rules for repairing shared structure. */
  readonly repairVersion: number;
  /** Canonical document model interpreted by a replica. */
  readonly canonicalModelVersion: number;
}

/**
 * Versions supported by this full-document collaboration release.
 *
 * Compare all four fields before admitting a client to synchronization. These values
 * describe the application schema, not the DOCX format or the Yjs binary update format.
 * Releases with the same tuple can share rooms. A changed tuple requires a coordinated
 * upgrade. This descriptor does not migrate persisted rooms or authenticate clients.
 * @public
 */
export const DOCUMENT_COLLABORATION_VERSIONS: DocumentCollaborationVersions = Object.freeze({
  protocolVersion: 1,
  sharedSchemaVersion: 3,
  repairVersion: 1,
  canonicalModelVersion: 1,
});

/** @internal */
export function documentCompatibilityFailure(versions: unknown): {
  readonly code: 'protocol-version-mismatch' | 'schema-version-mismatch';
  readonly detail: string;
} | null {
  const record =
    versions !== null && typeof versions === 'object' && !Array.isArray(versions)
      ? (versions as Record<string, unknown>)
      : {};
  for (const field of Object.keys(
    DOCUMENT_COLLABORATION_VERSIONS
  ) as (keyof DocumentCollaborationVersions)[]) {
    const expected = DOCUMENT_COLLABORATION_VERSIONS[field];
    const received = Object.hasOwn(record, field) ? record[field] : undefined;
    if (received === expected) continue;
    // Do not echo arbitrary metadata into logs or user-visible failure details.
    const actual =
      received === undefined
        ? 'missing'
        : typeof received === 'number' && Number.isSafeInteger(received)
          ? String(received)
          : 'invalid';
    return {
      code: field === 'protocolVersion' ? 'protocol-version-mismatch' : 'schema-version-mismatch',
      detail: `${field}: expected ${expected}, received ${actual}`,
    };
  }
  return null;
}

/**
 * Refuse an incompatible full-document client or persisted-room version descriptor.
 *
 * Pass the client's version tuple from your admission handshake before permitting sync.
 * Check persisted-room versions separately: a compatible client cannot migrate an older
 * room. This validates compatibility only; your server must also authorize access.
 * Missing or malformed fields refuse. Additional fields are ignored. Exact equality is
 * required for all four supported versions; no migration or shared-state mutation occurs.
 * Handle the stable error code; `detail` is a bounded diagnostic, not a parsing contract.
 *
 * @throws CollaborationSchemaError with `protocol-version-mismatch` or
 * `schema-version-mismatch`, including the field and expected/received version in `detail`.
 * @public
 */
export function assertDocumentCollaborationCompatibility(versions: unknown): void {
  const failure = documentCompatibilityFailure(versions);
  if (failure) throw new CollaborationSchemaError(failure.code, failure.detail);
}

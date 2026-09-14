/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type * as Y from 'yjs';
import { DOCUMENT_COLLABORATION_VERSIONS } from './document-compatibility.ts';
import { PACKAGE_META_KEY } from './document/schema.ts';
import { CollaborationSchemaError } from './schema.ts';

const VERSION_FIELDS = [
  'protocolVersion',
  'sharedSchemaVersion',
  'repairVersion',
  'canonicalModelVersion',
] as const;

function formatVersion(values: readonly number[]): string {
  return `docx-collaboration:${values.join('.')}`;
}

/**
 * Opaque collaboration format version, independent of the editor package version.
 *
 * Send this value unchanged during connection admission. Check it with
 * {@link assertCollaborationFormatCompatibility} before allowing synchronization.
 * Equal values declare format compatibility across clients, workers, and saved rooms.
 * Do not parse, order, hard-code, or override the value. It is not a credential.
 * Inspect saved rooms separately with {@link readCollaborationFormatVersion}.
 * @public
 */
export const COLLABORATION_FORMAT_VERSION: string = formatVersion(
  VERSION_FIELDS.map((field) => DOCUMENT_COLLABORATION_VERSIONS[field])
);

/**
 * Refuse a collaboration format version unsupported by this deployment.
 *
 * Pass the untrusted value received during connection admission, after authorizing
 * document access and before synchronization. Only an exact string match succeeds.
 * This check does not authenticate clients, validate room content, or migrate data.
 *
 * @throws CollaborationSchemaError with `collaboration-format-mismatch` for an
 * incompatible, missing, or malformed version. Use `code` for application logic.
 * @public
 */
export function assertCollaborationFormatCompatibility(version: unknown): void {
  if (version !== COLLABORATION_FORMAT_VERSION) {
    throw new CollaborationSchemaError(
      'collaboration-format-mismatch',
      'The collaboration format version is missing or incompatible with this deployment.'
    );
  }
}

/**
 * Read the opaque format version recorded in a synchronized or restored room.
 *
 * Reads version metadata without joining, exporting, or changing shared state.
 * Can inspect incompatible rooms; pass the result to
 * {@link assertCollaborationFormatCompatibility} before admitting their state.
 * The result does not validate document content or guarantee a successful export.
 * Use {@link readCollaborationDocument} to validate and export compatible content.
 *
 * @throws CollaborationSchemaError with `not-initialized` for an unseeded room,
 * or `collaboration-format-mismatch` for missing or malformed version metadata.
 * @public
 */
export function readCollaborationFormatVersion(ydoc: Y.Doc): string {
  if (!ydoc.share.has(PACKAGE_META_KEY)) {
    throw new CollaborationSchemaError('not-initialized');
  }
  let meta: Y.Map<unknown>;
  try {
    meta = ydoc.getMap(PACKAGE_META_KEY);
  } catch {
    throw new CollaborationSchemaError(
      'collaboration-format-mismatch',
      'The saved room has invalid collaboration version information.'
    );
  }
  if (meta.get('initialized') !== true || typeof meta.get('documentId') !== 'string') {
    throw new CollaborationSchemaError('not-initialized');
  }
  const values = VERSION_FIELDS.map((field) => {
    const value = meta.get(field);
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new CollaborationSchemaError(
        'collaboration-format-mismatch',
        'The saved room has missing or invalid collaboration version information.'
      );
    }
    return value;
  });
  return formatVersion(values);
}

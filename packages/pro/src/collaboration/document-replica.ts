/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Starting a full-document replica: validate the options, initialize or join shared state,
// materialize the package, and hand the parts to the session. Split out of
// `document-session.ts`, which owns the session class and passes its constructor in.

import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { writeOoxmlPackageKeepingRevisionIds } from '@docx-editor.dev/core/store';
import type { CollaborationIdentity } from '@docx-editor.dev/core/collaboration';
import { DocumentRegistry, PackageMaterializer } from './document/index.ts';
import { attachWatchdogDelay } from './document-session-watchdog.ts';
import { SHARED_BLOBS_KEY, SharedBlobStore } from './shared-blob-store.ts';
import { initializeSharedState } from './document-bootstrap.ts';
import { LogicalIdentityMap } from './document-identity.ts';
import { sessionIdentity, validateDocumentId, validateIdentity } from './document-awareness.ts';
import { CollaborationSchemaError } from './errors.ts';
import type { CollaborationHandle } from './types.ts';
import type { DocumentCollaborationSession } from './document-session-contract.ts';
import type { CreateDocumentCollaborationOptions } from './document-session-options.ts';

type DocumentCollaborationHandle = CollaborationHandle<DocumentCollaborationSession>;

/** What a session is built from, once shared state forms a document. */
export interface DocumentSessionParts {
  readonly ydoc: Y.Doc;
  readonly awareness: Awareness;
  readonly documentId: string;
  readonly sessionId: string;
  readonly identity: CollaborationIdentity;
  readonly registry: DocumentRegistry;
  readonly materializer: PackageMaterializer;
  readonly identityMap: LogicalIdentityMap;
  readonly blobs: SharedBlobStore;
  readonly attachWatchdogMs: number;
  readonly offlineEditing: boolean;
}

/** Builds the session from its parts. */
export type CreateDocumentSession = (parts: DocumentSessionParts) => DocumentCollaborationSession;

/** See `createDocumentCollaboration`, which documents the refusals. */
export async function createDocumentReplica(
  options: CreateDocumentCollaborationOptions,
  createSession: CreateDocumentSession
): Promise<DocumentCollaborationHandle> {
  const attachWatchdogMs = attachWatchdogDelay(options);
  const documentId = validateDocumentId(options.documentId);
  const sessionId = sessionIdentity(options.sessionId);
  const identity = validateIdentity(options.identity);
  const registry = new DocumentRegistry(options.ydoc);
  // A bootstrap that refuses must not leave this registry observing the caller's document:
  // the caller keeps `ydoc` (a retry, a different room), and a leaked observer taxes every
  // later transaction. On success the session owns the registry and detaches it on destroy.
  try {
    return await bootstrapDocumentReplica(
      options,
      { attachWatchdogMs, documentId, sessionId, identity, registry },
      createSession
    );
  } catch (error) {
    registry.destroy();
    throw error;
  }
}

interface DocumentReplicaContext {
  readonly attachWatchdogMs: number;
  readonly documentId: string;
  readonly sessionId: string;
  readonly identity: CollaborationIdentity;
  readonly registry: DocumentRegistry;
}

async function bootstrapDocumentReplica(
  options: CreateDocumentCollaborationOptions,
  context: DocumentReplicaContext,
  createSession: CreateDocumentSession
): Promise<DocumentCollaborationHandle> {
  const { attachWatchdogMs, documentId, sessionId, identity, registry } = context;
  // A run, text element or wrapper lives in its paragraph's shared text, not as a record.
  const identityMap = new LogicalIdentityMap(
    (logicalId) => registry.hasNode(logicalId) || registry.inline.owner(logicalId) !== null
  );
  const blobs = new SharedBlobStore(options.ydoc.getMap<Uint8Array>(SHARED_BLOBS_KEY));

  await initializeSharedState(options, registry, blobs, documentId);

  const materializer = new PackageMaterializer(registry, blobs);
  // Any throw between here and the return leaks the materializer's observers on the
  // caller's document — `current()` can throw on hostile shared state, and the refusals
  // below throw by design — so the whole tail hands the materializer back on the way out.
  // On success, ownership passes to the session, which detaches it on destroy.
  try {
    const materialized = materializer.current();
    const poisoned = blobs.poisonedDigest();
    if (poisoned) {
      // A blob that does not hash to its key reads downstream as a blob that is not there.
      // Say which it was, so a poisoned room is not reported as a truncated one.
      throw new CollaborationSchemaError('blob-digest-mismatch', poisoned);
    }
    if (!materialized.ok) {
      throw new CollaborationSchemaError(materialized.code);
    }
    // Serialize before the session exists: a throw here must not orphan a live session
    // whose registry and materializer the catch below is about to tear down. The replica
    // loads these bytes as the shared document, so revision ids stay as shared state holds them.
    const document = writeOoxmlPackageKeepingRevisionIds(materialized.package);
    const session = createSession({
      ydoc: options.ydoc,
      awareness: options.awareness,
      documentId,
      sessionId,
      identity,
      registry,
      materializer,
      identityMap,
      blobs,
      attachWatchdogMs,
      offlineEditing: options.offlineEditing !== false,
    });
    return Object.freeze({
      document,
      session,
      destroy: () => session.destroy(),
    });
  } catch (error) {
    materializer.destroy();
    throw error;
  }
}

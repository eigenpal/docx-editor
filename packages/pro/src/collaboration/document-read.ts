/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Server-side read of one collaboration room: shared state to `.docx` bytes, joining nothing.
 */

import type * as Y from 'yjs';
import { writeOoxmlPackage } from '@docx-editor.dev/core/store';
import { DocumentRegistry, PackageMaterializer } from './document/index.ts';
import { seedRecordCount } from './document-bootstrap.ts';
import { SHARED_BLOBS_KEY, SharedBlobStore, limitFailure } from './shared-blob-store.ts';
import { CollaborationSchemaError } from './schema.ts';
import { droppedContentDetail, packageVersionFailure } from './document/schema.ts';

/**
 * Read the document a synchronized `Y.Doc` holds, as `.docx` bytes.
 *
 * This is the server side of a room: export, autosave to your own storage, search indexing, a
 * nightly PDF, a webhook. It JOINS NOTHING. There is no identity, no `Awareness` and no
 * session, so the job that calls it never appears in anyone's avatar stack, and it creates no
 * editing gate, so it cannot write back.
 *
 * `ydoc` must already hold the room's state: connect your provider and wait for its initial
 * sync first, exactly as a `{ kind: \'join\' }` bootstrap does. A document that was never
 * seeded refuses with `not-initialized` rather than returning a truncated file.
 *
 * ```ts
 * // Hocuspocus hands `onStoreDocument` the synced Y.Doc already:
 * async onStoreDocument({ documentName, document }) {
 *   await writeFile(`${documentName}.docx`, readCollaborationDocument(document));
 * }
 * ```
 *
 * Synchronous, and it materializes the whole package per call — this is a job, not a render.
 *
 * @throws CollaborationSchemaError — `not-initialized`, `concurrent-seed`,
 * `protocol-version-mismatch`, `schema-version-mismatch`, `blob-digest-mismatch`,
 * `materialize-dropped-content`, `no-main-document-part`, or a limit code. Incomplete or
 * corrupt shared state refuses instead of producing an incomplete DOCX.
 * @public
 */
export function readCollaborationDocument(ydoc: Y.Doc): Uint8Array {
  const registry = new DocumentRegistry(ydoc);
  let materializer: PackageMaterializer | null = null;
  // Owned here, so released here — whether the read succeeded or refused. This runs once per
  // export on a document that lives as long as the room, so a leaked observer would make
  // every later transaction in the room pay for every export ever taken from it.
  try {
    if (
      registry.schema.meta.get('initialized') !== true ||
      typeof registry.schema.meta.get('documentId') !== 'string'
    ) {
      throw new CollaborationSchemaError('not-initialized');
    }
    // Export jobs interpret the same shared schema as joining peers. Refuse incompatible
    // split metadata before indexing it; treating v2 overlays as v3 ranges loses text.
    const versionFailure = packageVersionFailure(registry.schema.meta);
    if (versionFailure)
      throw new CollaborationSchemaError(versionFailure.code, versionFailure.detail);
    // Shared state arrived before this registry existed and the parent index is built from
    // child-array EVENTS — the same rebuild a joiner performs, for the same reason.
    registry.rebuildDerivedIndexes();
    // Two merged seeds duplicate the whole document and no reader can pick a side, so an
    // export refuses rather than writing a file with everything in it twice.
    if (seedRecordCount(ydoc) > 1) throw new CollaborationSchemaError('concurrent-seed');
    const blobs = new SharedBlobStore(ydoc.getMap<Uint8Array>(SHARED_BLOBS_KEY));
    const exceeded = limitFailure(registry, blobs);
    if (exceeded) throw new CollaborationSchemaError(exceeded.code, exceeded.detail);
    materializer = new PackageMaterializer(registry, blobs);
    const materialized = materializer.current();
    const poisoned = blobs.poisonedDigest();
    // A blob that does not hash to its key reads downstream as a blob that is not there. Say
    // which it was, so a poisoned room is not exported as a truncated one.
    if (poisoned) throw new CollaborationSchemaError('blob-digest-mismatch', poisoned);
    if (!materialized.ok) throw new CollaborationSchemaError(materialized.code);
    const dropped = droppedContentDetail(materialized.issues);
    if (dropped) throw new CollaborationSchemaError('materialize-dropped-content', dropped);
    if (!materialized.package.parts.has(materialized.package.mainDocumentPart)) {
      throw new CollaborationSchemaError('no-main-document-part');
    }
    return writeOoxmlPackage(materialized.package);
  } finally {
    materializer?.destroy();
    registry.destroy();
  }
}

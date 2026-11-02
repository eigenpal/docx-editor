/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Server-side read of one collaboration room: shared state to `.docx` bytes, joining nothing.
 */

import type * as Y from 'yjs';
import {
  writeOoxmlPackage,
  writeOoxmlPackageKeepingRevisionIds,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import { DocumentRegistry, PackageMaterializer } from './document/index.ts';
import { admitSharedState } from './document-bootstrap.ts';
import { SHARED_BLOBS_KEY, SharedBlobStore } from './shared-blob-store.ts';
import { CollaborationSchemaError } from './errors.ts';
import { droppedContentDetail } from './document/schema.ts';

/** Options for {@link readCollaborationDocument}. @public */
export interface ReadCollaborationDocumentOptions {
  /**
   * Keep every revision `w:id` as the room holds it. Pass `true` for the export that
   * `migrateCollaborationRoom` seeds a new room with: one change keeps one id across its
   * pieces, so the new room shows the same review items. Omitted or `false`, the file gives
   * each revision element its own in-range id, as a file for anyone to open needs.
   */
  readonly keepRevisionIds?: boolean;
}

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
 * For a room migration export, pass `{ keepRevisionIds: true }`; see
 * {@link ReadCollaborationDocumentOptions.keepRevisionIds}.
 *
 * @throws CollaborationSchemaError — `not-initialized`, `concurrent-seed`,
 * `protocol-version-mismatch`, `schema-version-mismatch`, `blob-digest-mismatch`,
 * `materialize-dropped-content`, `no-main-document-part`, or a limit code. Incomplete or
 * corrupt shared state refuses instead of producing an incomplete DOCX.
 * @public
 */
export function readCollaborationDocument(
  ydoc: Y.Doc,
  options?: ReadCollaborationDocumentOptions
): Uint8Array {
  return readRoomDocument(
    ydoc,
    options?.keepRevisionIds === true ? writeOoxmlPackageKeepingRevisionIds : writeOoxmlPackage
  );
}

/**
 * {@link readCollaborationDocument}, keeping every revision `w:id` as the room holds it.
 *
 * For bytes that go back into a room, as compaction and migration seed a new generation
 * with them: participants must see the same revisions, grouped the same way, after the new
 * generation as before it. A file for anyone to open uses {@link readCollaborationDocument}.
 *
 * @internal
 */
export function readCollaborationDocumentKeepingRevisionIds(ydoc: Y.Doc): Uint8Array {
  return readRoomDocument(ydoc, writeOoxmlPackageKeepingRevisionIds);
}

function readRoomDocument(ydoc: Y.Doc, write: (pkg: OoxmlPackage) => Uint8Array): Uint8Array {
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
    // An export reads the room as a joining peer does.
    const blobs = new SharedBlobStore(ydoc.getMap<Uint8Array>(SHARED_BLOBS_KEY));
    admitSharedState(registry, blobs, ydoc);
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
    return write(materialized.package);
  } finally {
    materializer?.destroy();
    registry.destroy();
  }
}

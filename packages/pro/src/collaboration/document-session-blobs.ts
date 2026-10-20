/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** Binary payloads a local journal publishes beside its effects. */

import type {
  CanonicalPrimitiveJournal,
  CollaborationDocumentPort,
} from '@docx-editor.dev/core/collaboration/replication';
import type { CollaborationFailure } from '@docx-editor.dev/core/collaboration';
import {
  binaryPartReaderOf,
  collectJournalBinaryPayloads,
  publishBinaryPayloads,
  type BinaryPayload,
} from './document/seed.ts';
import { CollaborationSchemaError } from './errors.ts';
import type { SharedBlobStore } from './shared-blob-store.ts';

/**
 * Resolve local binary bytes named by this journal before the Yjs transaction opens.
 *
 * `putBinary` carries a digest, not the bytes. A peer that applies the descriptor
 * without the payload fails materialize with `missing-blob` and keeps the old
 * document — the image paste never arrives, even when the story text did.
 * Bytes already live in the local package; a save/re-parse would walk every XML
 * node while the transaction is open.
 */
export function collectJournalBlobs(
  port: CollaborationDocumentPort | null,
  journal: CanonicalPrimitiveJournal
):
  | { readonly ok: true; readonly payloads: readonly BinaryPayload[] }
  | { readonly ok: false; readonly failure: CollaborationFailure }
  | null {
  if (!port) {
    const needed = journal.effects.some((effect) => effect.kind === 'putBinary');
    return needed
      ? {
          ok: false,
          failure: Object.freeze({ code: 'collaboration-session-not-attached' as const }),
        }
      : null;
  }
  const collected = collectJournalBinaryPayloads(journal.effects, binaryPartReaderOf(port));
  if (collected === null) return null;
  if (!collected.ok) {
    return { ok: false, failure: Object.freeze(collected.failure) };
  }
  return collected;
}

export function putJournalBlobs(
  blobs: SharedBlobStore,
  payloads: readonly BinaryPayload[]
): CollaborationFailure | null {
  try {
    publishBinaryPayloads(blobs, payloads);
  } catch (error) {
    return error instanceof CollaborationSchemaError
      ? Object.freeze({
          code: error.code,
          ...(error.detail ? { detail: error.detail } : {}),
        })
      : Object.freeze({ code: 'blob-store-full' as const });
  }
  return null;
}

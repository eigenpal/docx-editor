/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type * as Y from 'yjs';
import { keepFormattingMarkers } from './document/yjs-items.ts';
import { validateDocumentId } from './document-awareness.ts';
import { seedGeneration } from './room-generation.ts';
import { MAX_BASELINE_BYTES } from './legacy-compatibility.ts';

/**
 * Prepare a room's `Y.Doc` on a server that holds it, such as a Hocuspocus server. Call it
 * once when the server creates or loads the document, before it applies any update.
 *
 * @remarks
 * Paragraph text keeps formatting in Yjs formatting markers. After a remote update, Yjs
 * removes the markers it finds redundant from the document that received it. On a server,
 * that removal is a change of the server's own, which the server sends to every participant,
 * and it can remove the formatting of text a participant is typing. A prepared document does
 * not remove markers. Every editor replica is prepared already.
 *
 * @param document - The room document the server holds.
 * @returns A function that stops the preparation. Call it only when the server discards the
 * document.
 * @public
 */
export function prepareCollaborationServerDocument(document: Y.Doc): () => void {
  return keepFormattingMarkers(document);
}

/** Options for {@link createCollaborationState}. @public */
export interface CreateCollaborationStateOptions {
  /**
   * The room's document ID. Participants must use the same ID. With Hocuspocus it is the room
   * name, the `documentName` of the server hooks.
   */
  readonly documentId: string;
  /**
   * Refuse a file whose size, or whose expanded package size, is over this many bytes, with
   * `baseline-too-large`. The check runs before any part is parsed. Default and maximum
   * `MAX_BASELINE_BYTES` (20 MiB). A value that is not a whole number in that range throws
   * `TypeError`.
   */
  readonly maxBytes?: number;
}

/**
 * Build the state of a new room from a `.docx` file, on a server.
 *
 * @remarks
 * Call it only for a room that your application knows is new, for example from a durable
 * record that it writes when it creates the room. Store the result with a create-only write
 * before any participant syncs, then apply it to the room document with `Y.applyUpdate`.
 * Participants find the room seeded and join it with a `join` or `create-or-join` bootstrap.
 * No participant uploads the document, and none receives its own seed back.
 *
 * Do not seed a known room whose stored state is missing. A second seed replaces the room's
 * content with the original file, and every edit made since is gone from the room. Refuse the
 * room instead, for example with `saved-room-unavailable`: participants keep their copies, and
 * you can restore the stored state. As a last defense, each seed carries a new room generation
 * ID, so `checkCollaborationRoomGeneration` refuses a participant that holds the earlier state
 * with `room-generation-changed` instead of merging a second copy of the document.
 *
 * Hocuspocus does not call `onStoreDocument` for state applied while it loads a room, so store
 * the result yourself. Hocuspocus also holds back an update smaller than `flushMaxBytes` and
 * then sends it to every connection, the first participant included, which would receive the
 * room twice. Call `document.flush()` in `afterLoadDocument`, before the first participant joins.
 *
 * The work is synchronous for most of its run. Measured on a laptop, 4.4 MiB of expanded XML
 * (10,000 paragraphs) took 5.2 s, held the event loop for up to 210 ms at a time, and used
 * several hundred MiB of memory. Set `maxBytes` for the documents you accept, and seed in a
 * worker thread or a job queue with a small concurrency limit, not on the thread that serves
 * rooms.
 *
 * Throws `CollaborationSchemaError`: `baseline-too-large` for a file over `maxBytes`,
 * `invalid-baseline` for a file that is not a usable `.docx` package, and
 * `invalid-document-id` for a document ID that is empty or longer than 256 characters.
 * Throws `TypeError` for a `maxBytes` that is not a whole number from 1 to
 * `MAX_BASELINE_BYTES`.
 *
 * @param document - The `.docx` bytes the room starts from.
 * @param options - The room's document ID and size limit.
 * @returns The room's Yjs state, as one update.
 * @public
 */
export async function createCollaborationState(
  document: Uint8Array,
  options: CreateCollaborationStateOptions
): Promise<Uint8Array> {
  const documentId = validateDocumentId(options.documentId);
  const maxBytes = options.maxBytes ?? MAX_BASELINE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_BASELINE_BYTES) {
    // A configuration mistake, not shared state: thrown as other invalid options are.
    throw new TypeError(`maxBytes must be a whole number of bytes from 1 to ${MAX_BASELINE_BYTES}`);
  }
  return seedGeneration(document, documentId, maxBytes);
}

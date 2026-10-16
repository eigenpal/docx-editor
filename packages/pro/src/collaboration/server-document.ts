/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type * as Y from 'yjs';
import { keepFormattingMarkers } from './document/yjs-items.ts';
import { validateDocumentId } from './document-awareness.ts';
import { seedGeneration } from './room-generation.ts';

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
}

/**
 * Build the state of a new room from a `.docx` file, on a server.
 *
 * @remarks
 * Call it when the server loads a room that has no stored state, before any participant syncs.
 * Store the result, then apply it to the room document with `Y.applyUpdate`. Participants find
 * the room seeded and join it with a `join` or `create-or-join` bootstrap. No participant
 * uploads the document, and the server sends no seed back to the participant that sent it.
 *
 * The state carries a new room generation ID. If the server loses the stored state and seeds
 * the room again, `checkCollaborationRoomGeneration` refuses a participant that still holds
 * the earlier state with `room-generation-changed`. Without that refusal, the participant
 * would merge a second copy of the document into the room. Store the state before the first
 * participant syncs, so that a restart does not seed the room again.
 *
 * Throws `CollaborationSchemaError` for a file that is not a usable `.docx` package or is over
 * the size limit, and for an invalid document ID.
 *
 * @param document - The `.docx` bytes the room starts from.
 * @param options - The room's document ID.
 * @returns The room's Yjs state, as one update.
 * @public
 */
export async function createCollaborationState(
  document: Uint8Array,
  options: CreateCollaborationStateOptions
): Promise<Uint8Array> {
  return seedGeneration(document, validateDocumentId(options.documentId));
}

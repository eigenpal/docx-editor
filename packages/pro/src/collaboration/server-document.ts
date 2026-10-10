/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type * as Y from 'yjs';
import { keepFormattingMarkers } from './document/yjs-items.ts';

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

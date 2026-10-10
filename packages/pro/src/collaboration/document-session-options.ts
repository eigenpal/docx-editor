/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { CollaborationIdentity } from '@docx-editor.dev/core/collaboration';
import type { CollaborationBootstrap } from './types.ts';

/**
 * Options for one full-document collaboration replica.
 *
 * The caller owns `ydoc`.
 * @public
 */
export interface CreateDocumentCollaborationOptions {
  /** The room's Yjs document. Connect its provider before a `join` bootstrap. */
  readonly ydoc: Y.Doc;
  /** Presence channel for participants and remote selections, from `y-protocols/awareness`. */
  readonly awareness: Awareness;
  /** The room's document id, 1 to 256 characters. A room seeded with another id refuses. */
  readonly documentId: string;
  /** Unique attachment identity. Omit it to generate a new identity for this session. */
  readonly sessionId?: string;
  /** The local participant. Recorded as the author of this replica's changes. */
  readonly identity: CollaborationIdentity;
  /** Whether to seed the room, join it, or let the peers decide. */
  readonly bootstrap: CollaborationBootstrap;
  /**
   * Admit local edits while the transport is `disconnected`.
   *
   * A journal applies to the local `Y.Doc` either way, so buffered offline edits merge on
   * reconnect exactly as concurrent online edits do. On by default, as in other Yjs editors:
   * a dropped connection should not stop anyone typing. Show the `disconnected` status so
   * users know their edits have not reached the room yet. Pass `false` to pause editing
   * while disconnected. `error` and `initializing` refuse edits regardless of this option.
   */
  readonly offlineEditing?: boolean;
}

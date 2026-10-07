/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The selection each undo step was made from.
 *
 * Every step remembers the selection its author had before the change, and undo or redo
 * hands that selection back, so a selected word comes back selected and the caret returns to
 * where the author was, rather than to a position guessed from what the step changed. A redo
 * step is created by an undo, so it remembers the selection from before that undo.
 *
 * Offsets alone go stale: a peer typing before the selection between the change and its undo
 * moves the words the selection named. So each endpoint is kept on the shared character
 * beside it, as published, and comes back beside that character wherever it shows. An
 * endpoint whose character no longer shows (an undo restores deleted text as new
 * characters) is carried across the text of its paragraph instead, read at the same moment
 * as the selection.
 */
import type * as Y from 'yjs';
import type { CollaborationLocalSelection } from '@docx-editor.dev/core/collaboration';
import { mapOffsetAcrossText } from '@docx-editor.dev/core/collaboration/replication';
import type { EncodedCharacter } from './document-awareness.ts';

type Endpoint = CollaborationLocalSelection['anchor'] & { readonly character?: EncodedCharacter };

/** Where a published character shows now, by stable paragraph id, or null. */
export type FindEndpoint = (
  paragraphId: string,
  character: EncodedCharacter
) => CollaborationLocalSelection['anchor'] | null;

const SELECTION_META = 'docxEditorSelectionBefore';

interface Snapshot {
  readonly selection: {
    readonly anchor: Endpoint;
    readonly head: Endpoint;
    readonly kind?: CollaborationLocalSelection['kind'];
  };
  /** Paragraph text by stable id, read when the selection was set. */
  readonly texts: ReadonlyMap<string, string>;
}

export class HistorySelection {
  private latest: Snapshot | null = null;
  private before: Snapshot | null = null;
  private restored: Snapshot | null = null;
  private readonly onAdded = (event: { stackItem: { meta: Map<unknown, unknown> } }): void => {
    if (!event.stackItem.meta.has(SELECTION_META)) {
      event.stackItem.meta.set(SELECTION_META, this.before);
    }
  };
  private readonly onPopped = (event: { stackItem: { meta: Map<unknown, unknown> } }): void => {
    const snapshot = event.stackItem.meta.get(SELECTION_META);
    this.restored = (snapshot as Snapshot | null | undefined) ?? null;
  };

  constructor(
    private readonly undoManager: Y.UndoManager,
    /** A paragraph's current text by stable id, or null when this replica lacks it. */
    private readonly textOf: (paragraphId: string) => string | null,
    private readonly find: FindEndpoint = () => null
  ) {
    undoManager.on('stack-item-added', this.onAdded);
    undoManager.on('stack-item-popped', this.onPopped);
  }

  /**
   * The author's selection changed. Its offsets and the text they count in, read at the same
   * moment, are kept as a pair.
   */
  track(
    selection: {
      readonly anchor: Endpoint;
      readonly head: Endpoint;
      readonly kind?: 'cells';
    } | null,
    texts: ReadonlyMap<string, string> = new Map()
  ): void {
    if (!selection) {
      this.latest = null;
      return;
    }
    const plain = (point: Endpoint): Endpoint => ({
      paragraphId: point.paragraphId,
      offset: point.offset,
      ...(point.character ? { character: point.character } : {}),
    });
    this.latest = {
      selection: {
        anchor: plain(selection.anchor),
        head: plain(selection.head),
        ...(selection.kind ? { kind: selection.kind } : {}),
      },
      texts,
    };
  }

  /** The next tracked change is about to be made from the selection last tracked. */
  noteBefore(): void {
    this.before = this.latest;
  }

  /** Call before an undo or redo, so a stale answer from an earlier step is never reused. */
  startPop(): void {
    this.restored = null;
  }

  /**
   * The selection the last undo or redo restored, carried across text that changed since it
   * was recorded, or null when its step recorded none.
   */
  lastRestored(): CollaborationLocalSelection | null {
    const snapshot = this.restored;
    if (!snapshot) return null;
    const carry = (address: Endpoint): CollaborationLocalSelection['anchor'] => {
      const found = address.character ? this.find(address.paragraphId, address.character) : null;
      if (found) return found;
      const plain = { paragraphId: address.paragraphId, offset: address.offset };
      const before = snapshot.texts.get(address.paragraphId);
      const now = this.textOf(address.paragraphId);
      if (before === undefined || now === null) return plain;
      return { ...plain, offset: mapOffsetAcrossText(address.offset, before, now) };
    };
    const { selection } = snapshot;
    return {
      anchor: carry(selection.anchor),
      head: carry(selection.head),
      ...(selection.kind ? { kind: selection.kind } : {}),
    };
  }

  destroy(): void {
    this.undoManager.off('stack-item-added', this.onAdded);
    this.undoManager.off('stack-item-popped', this.onPopped);
  }
}

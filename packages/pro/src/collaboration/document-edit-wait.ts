/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Edits that wait for the room.
 *
 * Yjs holds an update back until the update it depends on arrives. Two edits must wait for
 * it, and the session refuses them before they commit, saying so (`waiting` on the status
 * snapshot) until they can go through:
 *
 * - any edit, while the editor shows less than shared state holds, because the edit would
 *   address nodes shared state no longer has;
 * - an edit of a paragraph whose text the held update carries. Shared state would refuse
 *   it after the commit, where the typed text only disappears.
 *
 * An edit anywhere else goes through: an update held back for other text waits for nothing.
 */
import type * as Y from 'yjs';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import { awaitingUpdates } from './document/yjs-items.ts';

export interface EditWaitDeps {
  readonly ydoc: Y.Doc;
  /** The editor shows less than shared state holds until a held-back update arrives. */
  readonly viewWaiting: () => boolean;
  /** Whether an edit addressing this editor node id waits for a held-back update. */
  readonly nodeWaits: (nodeId: string) => boolean;
  /** Publish whether edits wait now. */
  readonly publish: (waiting: boolean) => void;
}

export class EditWait {
  private waiting = false;

  constructor(private readonly deps: EditWaitDeps) {}

  /**
   * Whether these operations must wait. Called for every edit: without a held-back update it
   * reads two flags, and only with one does it look at the nodes the operations address.
   */
  refuses(ops: readonly TreeDocOp[]): boolean {
    if (this.deps.viewWaiting()) return this.set(true);
    if (!awaitingUpdates(this.deps.ydoc)) return this.set(false);
    return this.set(
      ops.some(
        (op) => WHOLE_SCOPE.has(op.op) || addressedIds(op).some((id) => this.deps.nodeWaits(id))
      )
    );
  }

  /** Shared state changed: edits may no longer wait. */
  refresh(): void {
    if (this.waiting && !this.deps.viewWaiting() && !awaitingUpdates(this.deps.ydoc)) {
      this.set(false);
    }
  }

  /** Record and publish the answer; returns it. */
  private set(waiting: boolean): boolean {
    if (waiting !== this.waiting) {
      this.waiting = waiting;
      this.deps.publish(waiting);
    }
    return waiting;
  }
}

/**
 * Operations that act on a whole story or document, wherever the waiting text is. Each
 * may reach it, so each waits while any update is held back.
 */
const WHOLE_SCOPE: ReadonlySet<string> = new Set([
  'acceptAllRevisions',
  'rejectAllRevisions',
  'replaceStoryBlocks',
  'convertAllNotes',
]);

/**
 * The node ids an operation addresses: every string named like an id (`paragraphId`),
 * every string in a list named like ids (`siteNodeIds`, `cellIds`), and the same inside the
 * objects a list holds (`sites[].nodeId`).
 */
function addressedIds(op: TreeDocOp): string[] {
  const ids: string[] = [];
  const read = (record: object, depth: number): void => {
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string') {
        if (key.endsWith('Id')) ids.push(value);
      } else if (Array.isArray(value)) {
        for (const entry of value) {
          if (typeof entry === 'string') {
            if (key.endsWith('Ids')) ids.push(entry);
          } else if (entry !== null && typeof entry === 'object' && depth < 3) {
            read(entry, depth + 1);
          }
        }
      } else if (value !== null && typeof value === 'object' && depth < 3) {
        read(value, depth + 1);
      }
    }
  };
  read(op, 0);
  return ids;
}

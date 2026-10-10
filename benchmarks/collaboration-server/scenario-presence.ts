// Oracles for where people are: the local caret, and the carets peers show.
//
// The caret: after a participant types, the caret sits right after what they typed. Remote
// edits then arrive, and the editor carries the caret across each one (`createRemoteCaret`,
// the same code the editor runs). While the typed token stays in that paragraph, the caret
// must stay right after it, wherever peers type, delete, or format around it.
//
// Presence: each participant publishes its caret. Once every replica holds the same document,
// every peer must show that caret in the same paragraph, at the same offset.

import type { SemanticSelection } from '@docx-editor.dev/core/layout';
import {
  paragraphTextOf,
  type OoxmlPart,
  type TreePackageStore,
} from '@docx-editor.dev/core/store';
import {
  carriedSelectionOf,
  createRemoteCaret,
  type RemoteCaret,
} from '../../packages/core/src/editor/surface-remote-caret.ts';
import { collaborationParagraphAt } from '../../packages/core/src/editor/surface-remote-selection.ts';
import type { Replica } from './scenario-replica.ts';
import { tokenNumber } from './scenario-tokens.ts';
import { paragraphs } from './scenario-tree.ts';

/** The body's paragraph IDs, in order. */
function paragraphOrder(store: TreePackageStore): string[] {
  return paragraphs(store.bodyStore().part.root).map((paragraph) => paragraph.id);
}

interface Caret {
  selection: SemanticSelection;
  /** The token typed last, which the caret sits right after. */
  readonly token: string;
  readonly mapper: RemoteCaret;
}

export class CaretWatch {
  private readonly carets = new Map<number, Caret>();

  constructor(private readonly problems: string[]) {}

  /** A replica typed `token` into a paragraph: the caret sits right after it. */
  typed(replica: Replica, paragraphId: string, token: string): void {
    const store = replica.store;
    const at = paragraphTextOf(store.bodyStore().part, paragraphId)?.indexOf(token) ?? -1;
    if (at < 0) {
      this.carets.delete(replica.index);
      return;
    }
    const offset = at + 1;
    const mapper = createRemoteCaret({
      textOf: (id) => paragraphTextOf(store.bodyStore().part, id),
      order: () => paragraphOrder(store),
      // The same answer the editor reads: the session carries the caret on the characters
      // beside it, and the mapper falls back to the text when it carries none.
      carried: () => carriedSelectionOf(replica.handle.session),
    });
    const position = { paragraphId, offset };
    this.carets.set(replica.index, {
      selection: { anchor: position, head: position },
      token,
      mapper,
    });
    this.publish(replica);
  }

  /** A replica made another edit, or an undo: the caret went where that edit put it. */
  moved(replica: Replica): void {
    this.carets.delete(replica.index);
  }

  /** A remote update is about to apply to a replica. */
  before(replica: Replica): void {
    const caret = this.carets.get(replica.index);
    if (caret) caret.mapper.note(caret.selection, [], true);
  }

  /** A remote update applied: carry the caret across it, and check it stayed after its token. */
  after(replica: Replica): void {
    const caret = this.carets.get(replica.index);
    if (!caret) return;
    const carried = caret.mapper.map(caret.selection);
    // The editor publishes a caret the change moved, so the session anchors it again.
    if (carried !== caret.selection) {
      caret.selection = carried;
      this.publish(replica);
    }
    const { paragraphId, offset } = caret.selection.head;
    const text = paragraphTextOf(replica.store.bodyStore().part, paragraphId);
    const at = text?.indexOf(caret.token) ?? -1;
    // The token left the paragraph, as a peer's Enter or join moves text: the caret lost what
    // it followed, and nothing after this can be compared.
    if (at < 0) {
      this.carets.delete(replica.index);
      return;
    }
    if (offset !== at + 1) {
      this.problems.push(
        `replica ${replica.index}'s caret after typed token ${tokenNumber(caret.token)} ` +
          `sits at offset ${offset}, not ${at + 1}, in ${paragraphId}`
      );
      this.carets.delete(replica.index);
    }
  }

  /** Publish a replica's caret as presence, as the editor does after each selection change. */
  private publish(replica: Replica): void {
    const caret = this.carets.get(replica.index);
    const head = caret?.selection.head;
    // As the editor names it: the paraId of the node in the part that holds it, any story.
    const stable = head
      ? collaborationParagraphAt(partOf(replica.store, head.paragraphId), head.paragraphId)
          ?.paragraphId
      : null;
    if (!head || !stable) {
      replica.handle.session.setLocalSelection(null);
      return;
    }
    const point = { paragraphId: stable, offset: head.offset };
    replica.handle.session.setLocalSelection({ anchor: point, head: point });
  }

  /**
   * With every replica holding the same document, each replica publishes its caret again, and
   * every peer must show it in the same paragraph at the same offset.
   */
  checkPresence(replicas: readonly Replica[]): void {
    for (const replica of replicas) this.publish(replica);
    for (const replica of replicas) {
      const caret = this.carets.get(replica.index);
      if (!caret) continue;
      const head = caret.selection.head;
      const stable = replica.port.paragraphByNodeId(head.paragraphId)?.paragraphId;
      if (!stable) continue;
      for (const peer of replicas) {
        if (peer === replica) continue;
        const shown = peer.handle.session
          .remoteSelections()
          .find((selection) => selection.actorId === `replica-${replica.index}`);
        if (!shown) {
          this.problems.push(`replica ${peer.index} shows no caret of replica ${replica.index}`);
          continue;
        }
        if (shown.head.paragraphId !== stable || shown.head.offset !== head.offset) {
          this.problems.push(
            `replica ${peer.index} shows replica ${replica.index}'s caret at ` +
              `${shown.head.paragraphId}:${shown.head.offset}, not ${stable}:${head.offset} ` +
              `(${JSON.stringify(peer.port.paragraphByStableId(stable)?.text ?? null)} there, ` +
              `${JSON.stringify(replica.port.paragraphByStableId(stable)?.text ?? null)} for its owner)`
          );
        }
      }
    }
  }
}

/** The part that holds a node, as the editor finds it: by the part name its id carries, else the body. */
function partOf(store: TreePackageStore, nodeId: string): OoxmlPart {
  const hash = nodeId.indexOf('#');
  const named = hash > 0 ? store.currentPackage().parts.get(nodeId.slice(0, hash)) : undefined;
  return named ?? store.bodyStore().part;
}

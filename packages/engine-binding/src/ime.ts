// IME composition state machine (document-engine task 6.8 / design D5). A
// composition records its start revision, anchored range, initial and composed
// text, and an ORDERED queue of inbound model changes that arrive mid-composition
// (intersecting reconciliation is deferred). Commit maps the final composed text
// as ONE insertText in ONE history group, then releases the queued changes in
// revision order; cancel discards the local composition and releases the queue.

import {
  DocumentStore,
  ORIGIN_IDS,
  type ModelChange,
  type CommitResult,
} from '@docx-editor.dev/engine-core';

export type ImeState = 'idle' | 'composing' | 'committed' | 'cancelled';

export interface InboundChange {
  readonly revision: number;
  readonly change: ModelChange;
}

export class ImeSession {
  private state: ImeState = 'idle';
  private paragraphId = '';
  private startRevision = 0;
  private composedText = '';
  private readonly inbound: InboundChange[] = [];

  get status(): ImeState {
    return this.state;
  }
  get text(): string {
    return this.composedText;
  }
  /** Revision the composition started at (inbound changes postdating it are deferred). */
  get baseRevision(): number {
    return this.startRevision;
  }

  /** Begin composition anchored to a paragraph at a start revision. */
  start(paragraphId: string, startRevision: number, initialText = ''): void {
    if (this.state === 'composing') throw new Error('composition already in progress');
    this.state = 'composing';
    this.paragraphId = paragraphId;
    this.startRevision = startRevision;
    this.composedText = initialText;
    this.inbound.length = 0;
  }

  /** Update the in-flight composed text. */
  update(composedText: string): void {
    this.assertComposing();
    this.composedText = composedText;
  }

  /** Buffer an inbound model change that arrived during composition (ordered). */
  receiveInbound(change: ModelChange): void {
    this.assertComposing();
    this.inbound.push({ revision: change.toRevision, change });
  }

  /** Ordered queue of changes deferred during composition. */
  get pendingInbound(): readonly InboundChange[] {
    return [...this.inbound].sort((a, b) => a.revision - b.revision);
  }

  /**
   * Commit: insert the composed text as ONE history group, then hand back the
   * ordered inbound queue for the binding to reconcile.
   */
  commit(store: DocumentStore): { result: CommitResult; flush: readonly InboundChange[] } {
    this.assertComposing();
    const result = store.transact(ORIGIN_IDS.mutationHuman, (ctx) => {
      if (this.composedText.length > 0) {
        ctx.apply({ op: 'insertText', paragraphId: this.paragraphId, text: this.composedText });
      }
    });
    this.state = 'committed';
    return { result, flush: this.pendingInbound };
  }

  /** Cancel: discard the local composition; hand back the inbound queue. */
  cancel(): { flush: readonly InboundChange[] } {
    this.assertComposing();
    this.state = 'cancelled';
    this.composedText = '';
    return { flush: this.pendingInbound };
  }

  private assertComposing(): void {
    if (this.state !== 'composing') throw new Error(`IME not composing (state: ${this.state})`);
  }
}

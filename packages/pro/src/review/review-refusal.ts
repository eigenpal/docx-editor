/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

// Why a review write did not land, for the review UI of both adapters.
//
// The editor names the cause of a refused accept, reply or delete (an external refresh, viewing,
// protection, a collaboration session that is not ready). The review hooks used to reduce each
// answer to a boolean, so a card's button did nothing and said nothing.

import {
  diagnosticCodeOfRefusal,
  reviewCodeOfRefusal,
  reviewCodeOfSkip,
} from '@docx-editor.dev/core';

import type {
  EditDiagnosticCode,
  Editor,
  ReviewDiagnosticCode,
} from '@docx-editor.dev/core/contracts/editor';
import type { ExecResult } from '@docx-editor.dev/core/contracts/types';
import type { TranslationKey } from '@docx-editor.dev/i18n';

/** What a skip's refusal leads with: a detail with its own code, such as a lock, else the reason. */
function skipLead(skip: { readonly reason: string; readonly detail?: string }): string {
  const own =
    skip.detail !== undefined &&
    reviewCodeOfSkip(skip) !== reviewCodeOfSkip({ reason: skip.reason });
  return own ? skip.detail! : skip.reason;
}

/**
 * The review write a refusal answered.
 *
 * @public
 */
export type ReviewWriteAction =
  | 'accept'
  | 'reject'
  | 'resolve'
  | 'reopen'
  | 'remove'
  | 'reply'
  | 'comment';

/**
 * A review write the editor refused.
 *
 * @public
 */
export interface ReviewWriteRefusal {
  /** Which write was refused. A discarded tracked change reports `'reject'`. */
  readonly action: ReviewWriteAction;
  /** The card the write addressed, or null for a new comment on the selection. */
  readonly key: string | null;
  /**
   * The public diagnostic code, the same one `onDiagnostic` reports for the refusal. A tracked
   * change the engine could not decide names its review code, such as
   * `review.retained-structure` for a row that stays to keep a nested table.
   */
  readonly code: EditDiagnosticCode | ReviewDiagnosticCode;
  /**
   * Rises with every refusal of this editor, so the same refusal twice still differs. Key a
   * live announcement on it to announce a repeat.
   */
  readonly sequence: number;
  /**
   * True when retrying cannot help: the collaboration session ended, so the document must be
   * opened again before it takes another review write.
   */
  readonly final: boolean;
}

/** The refusal behind a write's result, or null when the write landed. */
export function reviewWriteRefusalOf(
  action: ReviewWriteAction,
  key: string | null,
  result: ExecResult,
  sequence: number
): ReviewWriteRefusal | null {
  if (result.ok) return null;
  // Only a decision on a tracked change names a review code; a reply or a comment write keeps
  // its edit code.
  const decision = action === 'accept' || action === 'reject';
  const code =
    (decision && typeof result.reason === 'string' ? reviewCodeOfRefusal(result.reason) : null) ??
    diagnosticCodeOfRefusal(result.reason, result.code);
  const final = result.reason === 'collaboration-session-destroyed';
  return { action, key, code, sequence, final };
}

/**
 * The review author filter as a comparable key. The review hooks re-derive when it changes,
 * and a held refusal is about the filter it was refused under.
 */
export function reviewAuthorFilterKey(
  editor: Editor,
  snapshot = (
    editor as Editor & { snapshot?: () => { readonly hiddenReviewAuthors?: readonly string[] } }
  ).snapshot?.()
): string {
  return JSON.stringify(snapshot?.hiddenReviewAuthors ?? []);
}

/**
 * The packaged sentence for a refusal: its cause when the editor named one, else `fallback`.
 *
 * A cause the editor names gets its own sentence with a next step: a refresh, viewing,
 * protection, the collaboration session, and every `review.*` code. Any other refusal keeps the
 * action's own sentence.
 */
export function reviewRefusalLabelKey(
  code: EditDiagnosticCode | ReviewDiagnosticCode | undefined,
  fallback: TranslationKey,
  final = false
): TranslationKey {
  if (final) return 'review.refusedSessionEnded';
  switch (code) {
    case 'edit.refresh-in-progress':
      return 'review.refusedRefresh';
    case 'edit.read-only':
      return 'review.refusedViewing';
    case 'edit.protected-content':
      return 'review.refusedProtected';
    case 'edit.collaboration-not-ready':
      return 'review.refusedCollaboration';
    case 'review.retained-structure':
      return 'review.refusedRetainedStructure';
    case 'review.incomplete-group':
      return 'review.refusedIncompleteGroup';
    case 'review.revision-unsupported':
      return 'review.refusedUnsupported';
    case 'review.stale-revision':
      return 'review.refusedStale';
    case 'review.locked-content':
      return 'review.refusedLockedContent';
    case 'review.bound-content':
      return 'review.refusedBoundContent';
    default:
      return fallback;
  }
}

/** The packaged sentence for a refused review write; hosts reach it as `useReviewRefusalMessage`. */
export function reviewRefusalMessage(
  refusal: ReviewWriteRefusal,
  t: (key: TranslationKey) => string
): string {
  return t(
    reviewRefusalLabelKey(refusal.code, reviewRefusalFallbackKey(refusal.action), refusal.final)
  );
}

/** The packaged sentence for an action refused without a cause a reader can act on. */
export function reviewRefusalFallbackKey(action: ReviewWriteAction): TranslationKey {
  if (action === 'reply') return 'review.replyRefused';
  if (action === 'comment') return 'review.commentRefused';
  return 'review.actionRefused';
}

/**
 * The editor state a refusal is about. A change to any part of it means the cause may be gone:
 * the document changed (a refresh replaced it, a peer's edit arrived), the editing mode or
 * editability changed (a refresh ended, viewing was left), the collaboration session changed
 * state, or the author filter changed. A caret move is not in it, so a notice survives the
 * reader clicking around.
 */
function refusalStateKey(editor: Editor): string {
  const snapshot = editor.snapshot();
  return [
    editor.getDocumentHandle().revision,
    editor.getEditingMode(),
    snapshot.editable,
    // The raw status. Which statuses take writes is the session's rule, not this module's, so
    // any change is a point to retry at; a write still blocked records its cause again.
    snapshot.collaborationStatus,
    reviewAuthorFilterKey(editor, snapshot),
  ].join(':');
}

/** The last refused review write of one editor, shared by every review hook over it. */
export interface ReviewRefusalStore {
  /** The held refusal, or null. */
  get(): ReviewWriteRefusal | null;
  /** Record a write's result: hold its refusal, or clear the held one when it landed. */
  record(action: ReviewWriteAction, key: string | null, result: ExecResult): void;
  /** Called when the held refusal is set or cleared. */
  subscribe(listener: () => void): () => void;
}

const stores = new WeakMap<Editor, ReviewRefusalStore>();

/**
 * The refusal store of `editor`, created on first use.
 *
 * Per EDITOR, not per hook call: a custom card that reads `useReview().lastRefusal` must see a
 * refusal that the packaged rail's own Accept, or another component's hook, recorded.
 */
export function reviewRefusalStore(editor: Editor): ReviewRefusalStore {
  const existing = stores.get(editor);
  if (existing) return existing;
  let held: { readonly refusal: ReviewWriteRefusal; readonly at: string } | null = null;
  let count = 0;
  const listeners = new Set<() => void>();
  let detach: (() => void) | null = null;
  let offResolved: (() => void) | null = null;
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  // Editor events are watched only while a refusal is held and someone is listening: an idle
  // store adds nothing to the editor's listener lists.
  const sync = (): void => {
    const wanted = held !== null && listeners.size > 0;
    if (wanted && !detach) {
      // Every event the review hooks re-derive on. A mode switch can arrive without `change`,
      // and the key leaves the caret out, so a selection event alone never clears it.
      const offChange = editor.on('change', recheck);
      const offSelection = editor.on('selectionChange', recheck);
      const offError = editor.on('error', recheck);
      detach = () => {
        offChange();
        offSelection();
        offError();
      };
    } else if (!wanted && detach) {
      detach();
      detach = null;
    }
  };
  // The cause is gone once the state it was refused in changes. Cleared then, not only on the
  // next write, so a notice never outlives its cause.
  function recheck(): void {
    if (held && held.at !== refusalStateKey(editor)) {
      held = null;
      sync();
      notify();
    }
  }
  const store: ReviewRefusalStore = {
    get: () => held?.refusal ?? null,
    record(action, key, result) {
      const refusal = reviewWriteRefusalOf(action, key, result, count + 1);
      if (refusal) count = refusal.sequence;
      const changed = refusal !== null || held !== null;
      held = refusal ? { refusal, at: refusalStateKey(editor) } : null;
      sync();
      if (changed) notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      // An accept-all or reject-all that leaves changes pending says why on the first one's
      // card, as a card decision refused for that reason would.
      offResolved ??= editor.on('reviewChangesResolved', ({ action, skipped }) => {
        // A key a caller named that no longer exists has no card to explain.
        const first = skipped.find((skip) => skip.reason !== 'unknown-revision');
        store.record(
          action,
          first ? (first.pairKey ?? first.key) : null,
          first
            ? {
                ok: false,
                code: 'unsupported',
                reason: `${skipLead(first)}: the change stays pending`,
              }
            : { ok: true, changed: true }
        );
      });
      sync();
      // A refusal held while nobody listened may be about a state that has since moved on.
      // Checked after the subscribe returns, so subscribing never notifies other readers from
      // inside a render or a watcher setup.
      queueMicrotask(recheck);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          offResolved?.();
          offResolved = null;
        }
        sync();
      };
    },
  };
  stores.set(editor, store);
  return store;
}

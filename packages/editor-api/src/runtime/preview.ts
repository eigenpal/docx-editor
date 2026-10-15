/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A preview: other wording shown in the page before anyone writes it.
//
// This is DocxEditor infrastructure. Office.js has no preview, so the preview itself is an
// option of the runtime, and the edits inside its callback stay ordinary Office.js calls.
//
// THE CALLBACK WRITES TO A FORK. The browser editor lends a scratch automation host over a copy
// of its current package, and paints that copy over its pages when the callback finishes. The
// fork joins no collaboration room and has no undo history the editor can see, so a peer never
// receives a preview and an undo never meets one. The live editor stays editable while the
// callback runs; once the preview shows, the editor refuses every write, including this
// runtime's own runs, with `PreviewActive`.
//
// COMMIT REPLAYS, IT NEVER RE-RUNS. Every batch the callback sent is recorded with its answer.
// Commit sends the same batches to the live host, inside one editor history group, translating
// the fork's handles and revisions to the live host's. The live answers must match the fork's
// (see `preview-replay.ts`); if one does not, the replayed writes are undone as the one step
// they form, and commit refuses. A live document that moved since the preview began refuses
// `StaleDocument` and keeps the preview, unless the caller asks to rebase. The callback never
// runs twice, so it can have side effects of its own.

import type {
  AutomationBatchRequest,
  AutomationBatchResponse,
  AutomationHost,
  AutomationOperation,
  AutomationOperationResult,
  HistoryGroup,
} from '@docx-editor.dev/core/automation';
import { isAutomationCommand } from '@docx-editor.dev/core/automation';
import { DocxEditorError, fail } from './errors.ts';
import { contentGuards, replayPreview, type PreviewEntry } from './preview-replay.ts';
import type { RequestContext } from './request-context.ts';

/**
 * Where a {@link DocumentPreview} is in its life.
 *
 * - `active`: the page shows the preview, and the live document has not moved since the
 *   preview began.
 * - `stale`: the live document moved after the preview began: a collaboration peer edited it,
 *   or a local write landed while the callback ran. The page still shows the preview.
 *   `commit()` refuses with `StaleDocument`; `commit({ rebase: true })` replays it on the
 *   current document instead.
 * - `ended`: the preview was committed, discarded, or ended because its runtime was disposed or
 *   the editor loaded, detached, or remounted. The page shows the live document. Final.
 *
 * @example
 * ```ts
 * preview.onStatusChanged((status) => {
 *   applyButton.textContent = status === 'stale' ? 'Apply to the current text' : 'Apply';
 * });
 * ```
 * @public
 */
export type DocumentPreviewStatus = 'active' | 'stale' | 'ended';

/**
 * What {@link DocxEditorRuntime.preview} hands its callback: an ordinary request context
 * whose reads and writes address the preview, not the live document.
 *
 * Write it as you would write the final edit, from data you already have. The editor stays
 * editable while the callback runs, so a callback that waits on a model call lets the document
 * move under it, and the preview then starts `stale`. Ask the model first, then preview.
 *
 * Text and formatting edits work in the body, headers, footers, and notes. The callback cannot
 * write tables, pictures, fields, lists, hyperlinks, content controls, or page setup, create or
 * delete headers, footers, or notes, or move the selection: `context.sync()` refuses those with
 * `NotSupported`. Comments are written in the body only, as in `run()`.
 *
 * @example
 * ```ts
 * const proposal = await model.propose(clauseText); // before the preview, not inside it
 * const preview = await runtime.preview(async (context) => {
 *   context.document.changeTrackingMode = 'TrackMineOnly';
 *   const range = context.document.body.search(proposal.find).getFirst();
 *   range.insertText(proposal.replace, 'Replace');
 *   await context.sync();
 * });
 * ```
 * @public
 */
export type PreviewCallback<T = void> = (context: RequestContext) => Promise<T>;

/**
 * Options for {@link DocumentPreview.commit}.
 *
 * @example
 * ```ts
 * await preview.commit({ rebase: true });
 * ```
 * @public
 */
export interface CommitPreviewOptions {
  /**
   * When the live document moved after the preview began, replay the preview on the current
   * document instead of refusing. Ranges follow the text they name, so an edit elsewhere, even
   * earlier in the same paragraph, rebases. The replay still refuses with `StaleDocument`, and
   * writes nothing, when a replayed read answers differently or a write would overwrite text
   * that changed: a search finds a different number of matches, text the preview read now
   * reads otherwise, or the range, paragraph, or span a write replaces or formats holds other
   * text. Omitted or false, any move refuses.
   */
  readonly rebase?: boolean;
}

/**
 * Other wording, shown in the page over the live document until it is committed or
 * discarded. Answered by {@link DocxEditorRuntime.preview}.
 *
 * This is DocxEditor infrastructure with no Office.js equivalent.
 *
 * @example
 * ```ts
 * const preview = await runtime.preview(async (context) => {
 *   context.document.changeTrackingMode = 'TrackMineOnly';
 *   const range = context.document.body.search('thirty (30) days').getFirst();
 *   range.insertText('forty-five (45) days', 'Replace');
 *   await context.sync();
 * });
 * preview.reveal(); // scroll to the counter-proposal
 * // The page shows it as a tracked change. The live document is unchanged.
 * if (userAccepted) await preview.commit();
 * else preview.discard();
 * ```
 * @public
 */
export interface DocumentPreview<T = void> {
  /**
   * What the callback answered, as `run()` answers its callback's value. Return plain data from
   * the callback, never a proxy: proxies end with the callback.
   *
   * @example
   * ```ts
   * const preview = await runtime.preview(async (context) => {
   *   const range = context.document.body.search('thirty (30) days').getFirst();
   *   range.insertText('forty-five (45) days', 'Replace');
   *   await context.sync();
   *   return { replaced: 'thirty (30) days' };
   * });
   * console.log(preview.result.replaced);
   * ```
   */
  readonly result: T;
  /**
   * Where the preview is in its life. Read it at any time; it changes without a sync.
   *
   * @example
   * ```ts
   * if (preview.status === 'stale') await preview.commit({ rebase: true });
   * ```
   */
  readonly status: DocumentPreviewStatus;
  /**
   * Write the preview to the live document as one undo step, then end the preview.
   *
   * Commit replays the preview's batches, in order, against the live document inside one
   * editor history group. It never runs the callback again. A tracking mode the callback set
   * stays set on this runtime afterwards, as it does after `run()`.
   *
   * Refusals:
   *
   * - `StaleDocument` when the live document moved after the preview began
   *   (`expectedRevision` and `actualRevision` say from where to where). Nothing is written and
   *   the preview stays open: call `commit({ rebase: true })` or `discard()`.
   * - `StaleDocument` from `commit({ rebase: true })` when a replayed read answers differently
   *   or a write would overwrite changed text (`edit.preview-diverged`). Nothing stays written, and the preview ends.
   * - `PreviewEnded` when the preview was already committed, discarded, or ended by a remount.
   * - Any refusal the live document gives a replayed batch, such as a collaboration session
   *   that is not ready. Replayed writes before it are undone as one step, and the preview ends.
   *   If that undo itself fails, the error is `GeneralException` with target `preview.rollback`.
   *
   * @example
   * ```ts
   * try {
   *   await preview.commit();
   * } catch (error) {
   *   if (!isDocxEditorError(error) || error.code !== 'StaleDocument') throw error;
   *   if (preview.status === 'stale') await preview.commit({ rebase: true });
   * }
   * ```
   */
  commit(options?: CommitPreviewOptions): Promise<void>;
  /**
   * End the preview without writing anything. The page shows the live document again, with
   * its selection, scroll position, and focus as they were. A tracking mode the callback set
   * is discarded with the preview. Safe to call more than once and after `commit()`.
   * Disposing the runtime that opened the preview discards it too.
   *
   * @example
   * ```ts
   * cancelButton.onclick = () => preview.discard();
   * ```
   */
  discard(): void;
  /**
   * Scroll the page to the first paragraph of the document body the preview changed. Answers
   * false, scrolling nothing, when the preview has ended or changed no body paragraph: an
   * edit only in a header, a footer, or a note is not found.
   *
   * @example
   * ```ts
   * const preview = await runtime.preview(counterProposal);
   * preview.reveal();
   * ```
   */
  reveal(): boolean;
  /**
   * Be told when {@link DocumentPreview.status} changes: to `stale` when the live document
   * moves, and to `ended` once. Returns a function that removes the listener.
   *
   * @example
   * ```ts
   * const stop = preview.onStatusChanged((status) => {
   *   if (status === 'stale') showBanner('The clause changed since this preview.');
   * });
   * ```
   */
  onStatusChanged(listener: (status: DocumentPreviewStatus) => void): () => void;
}

/** Why the editor would not open a fork. @internal */
export type PreviewForkRefusal =
  | 'no-document'
  | 'viewing'
  | 'blocked'
  | 'composing'
  | 'preview-active';

/** The fork the browser editor lends a preview. @internal */
export interface PreviewFork {
  readonly host: AutomationHost;
  show(): boolean;
  reveal(): boolean;
  readonly ended: boolean;
  end(): void;
  onEnd(listener: () => void): () => void;
}

/** What a browser runtime gives the preview. Absent on a server runtime. @internal */
export interface PreviewPort {
  begin():
    | { readonly ok: true; readonly fork: PreviewFork }
    | { readonly ok: false; readonly reason: PreviewForkRefusal };
  /** A new open editor history group, for the commit's one undo step. */
  beginHistoryGroup(): HistoryGroup;
  /** Undo the editor's last step, after a divergent replay. False when the editor refused. */
  undo(): boolean;
}

/** What `preview` needs from the runtime that owns it. @internal */
export interface PreviewRuntime {
  readonly port: PreviewPort;
  /** The live host, unguarded. */
  readonly host: AutomationHost;
  readonly author?: string;
  /** One run's frames of a history group, or `null`. The runtime's `historyGroups.begin`. */
  groupRun(group: HistoryGroup): {
    execute(request: AutomationBatchRequest): AutomationBatchResponse | null;
    finish(): void;
  } | null;
  /** Run `callback` in a fresh request context over `host`. */
  runOn<T>(host: AutomationHost, callback: PreviewCallback<T>): Promise<T>;
}

/**
 * Commands a preview can show. Text, paragraphs, formatting, comments, and tracked-change
 * decisions, by span (`Range.revisions`) or by review-queue key, and every read, including
 * `getReviewItemRange`; nothing that adds parts, tables, pictures, fields, lists, or content controls, and
 * nothing that moves a selection the preview does not have. Everything else is refused with
 * `NotSupported` rather than shown differently from how it would commit.
 */
const PREVIEW_COMMANDS: ReadonlySet<string> = new Set([
  'setChangeTrackingMode',
  'insertText',
  'replaceSpan',
  'insertParagraph',
  'splitParagraph',
  'deleteParagraph',
  'setFont',
  'setParagraphFormat',
  'setStyle',
  'proposeInsertion',
  'proposeDeletion',
  'proposeReplacement',
  'insertComment',
  'replyToComment',
  'setCommentResolved',
  'deleteComment',
  'acceptRevision',
  'rejectRevision',
  'acceptAllRevisions',
  'rejectAllRevisions',
  'resolveRevisionBatch',
  'setRevisionAuthorBatch',
]);

function previewSupports(operation: AutomationOperation): boolean {
  if (!isAutomationCommand(operation)) return true;
  if (operation.op === 'insertBreak') return operation.breakType === 'Line';
  return PREVIEW_COMMANDS.has(operation.op);
}

/** The fork host as the callback sees it: refusing what a preview cannot show, recording the rest. */
function recordingHost(fork: AutomationHost, log: PreviewEntry[]): AutomationHost {
  return {
    ...fork,
    execute(request) {
      const operations = Array.isArray(request?.operations) ? request.operations : [];
      const refused = operations.findIndex((operation) => !previewSupports(operation));
      if (refused >= 0) {
        return {
          ok: false,
          results: operations.map(
            (_, index): AutomationOperationResult =>
              index === refused
                ? {
                    status: 'error',
                    error: {
                      code: 'unsupported-capability',
                      message: 'a preview cannot show this operation',
                      detail: 'preview-operation-unsupported',
                    },
                  }
                : { status: 'skipped' }
          ),
          revision: fork.revision(),
          changed: false,
        };
      }
      const before = fork.revision();
      // What the writes are about to overwrite, read first, so the commit can check the live
      // document still reads the same there.
      const guarded = contentGuards(operations);
      const guards =
        guarded.length > 0
          ? { request: { operations: guarded }, response: fork.execute({ operations: guarded }) }
          : undefined;
      const response = fork.execute(request);
      log.push({ request, response, before, ...(guards ? { guards } : {}) });
      return response;
    },
  };
}

/** The error for a fork the editor would not open, with the engine's reason as `innerError`. */
function forkRefusal(reason: PreviewForkRefusal): DocxEditorError {
  switch (reason) {
    case 'preview-active':
      return new DocxEditorError({ code: 'PreviewActive', diagnostic: 'edit.preview-active' });
    case 'no-document':
      return new DocxEditorError({ code: 'DocumentUnavailable' });
    case 'viewing':
      return new DocxEditorError({
        code: 'NotSupported',
        target: 'preview',
        diagnostic: 'edit.read-only',
      });
    case 'blocked':
      return new DocxEditorError({
        code: 'NotSupported',
        target: 'preview',
        diagnostic: 'edit.refresh-in-progress',
      });
    case 'composing':
      return new DocxEditorError({
        code: 'NotSupported',
        target: 'preview',
        diagnostic: 'edit.preview-composing',
      });
  }
}

/**
 * Open a preview: fork, run the callback against the fork, and paint it.
 *
 * On any failure the fork ends before the error propagates, so the page never keeps showing a
 * preview nobody holds.
 */
export async function openPreview<T>(
  runtime: PreviewRuntime,
  callback: PreviewCallback<T>
): Promise<DocumentPreview<T>> {
  const begun = runtime.port.begin();
  if (!begun.ok) throw forkRefusal(begun.reason);
  const fork = begun.fork;
  try {
    const base = runtime.host.revision();
    seedTracking(runtime, fork.host);
    const forkBase = fork.host.revision();
    const log: PreviewEntry[] = [];
    const result = await runtime.runOn(recordingHost(fork.host, log), callback);
    if (fork.ended) fail({ code: 'PreviewEnded', target: 'preview' });
    if (!fork.show()) fail({ code: 'GeneralException', target: 'preview' });
    return new Preview(runtime, fork, log, base, forkBase, result);
  } catch (error) {
    fork.end();
    throw error;
  }
}

/**
 * Start the fork in the change-tracking mode this runtime's host is in, so a preview built by
 * a runtime already tracking its writes shows them tracked, as its commit will write them.
 */
function seedTracking(runtime: PreviewRuntime, fork: AutomationHost): void {
  const answer = runtime.host.execute({ operations: [{ op: 'getChangeTrackingMode' }] });
  const result = answer.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'text') return;
  if (result.value.text !== 'TrackMineOnly' || runtime.author === undefined) return;
  fork.execute({
    operations: [{ op: 'setChangeTrackingMode', mode: 'TrackMineOnly', author: runtime.author }],
  });
}

class Preview<T> implements DocumentPreview<T> {
  #status: DocumentPreviewStatus = 'active';
  readonly #listeners = new Set<(status: DocumentPreviewStatus) => void>();
  #unsubscribe: (() => void) | undefined;
  #unsubscribeEnd: (() => void) | undefined;

  constructor(
    private readonly runtime: PreviewRuntime,
    private readonly fork: PreviewFork,
    private readonly log: readonly PreviewEntry[],
    private readonly base: number,
    private readonly forkBase: number,
    readonly result: T
  ) {
    this.#unsubscribe = runtime.host.subscribe((event) => {
      if (this.#status === 'active' && event.revision !== base) this.#set('stale');
    });
    // A remount ends the fork from the editor's side; the preview ends with it.
    this.#unsubscribeEnd = fork.onEnd(() => this.#end());
    if (runtime.host.revision() !== base) this.#set('stale');
  }

  get status(): DocumentPreviewStatus {
    return this.#status;
  }

  onStatusChanged(listener: (status: DocumentPreviewStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  discard(): void {
    this.#end();
  }

  reveal(): boolean {
    return this.#status !== 'ended' && this.fork.reveal();
  }

  async commit(options: CommitPreviewOptions = {}): Promise<void> {
    if (this.#status === 'ended') fail({ code: 'PreviewEnded', target: 'preview' });
    const rebase = options?.rebase === true;
    const actual = this.runtime.host.revision();
    const moved = actual !== this.base;
    if (moved) this.#set('stale');
    // Refused BEFORE anything ends: the preview stays, so the caller can rebase or discard.
    if (moved && !rebase) {
      fail({
        code: 'StaleDocument',
        target: 'preview',
        expectedRevision: this.base,
        actualRevision: actual,
      });
    }
    // Ended before the replay: the write guard must lift before the live editor can take it.
    this.#end();
    this.#replay(actual, moved);
  }

  #replay(liveBase: number, moved: boolean): void {
    const { runtime } = this;
    const group = runtime.port.beginHistoryGroup();
    const run = runtime.groupRun(group);
    const outcome = replayPreview(
      this.log,
      {
        execute: (request) => (run ? run.execute(request) : runtime.host.execute(request)),
        revision: () => runtime.host.revision(),
      },
      this.forkBase,
      liveBase
    );
    run?.finish();
    group.end();
    if (outcome.ok) return;
    // The replayed writes are one step of the group: one undo takes all of them back.
    if (outcome.wrote && !runtime.port.undo()) {
      fail({ code: 'GeneralException', target: 'preview.rollback' });
    }
    if (outcome.refusal) throw outcome.refusal;
    // A disagreement on a document that moved is the move's doing; on one that did not, it is
    // the engine's.
    fail(
      moved
        ? {
            code: 'StaleDocument',
            target: 'preview',
            expectedRevision: this.base,
            actualRevision: liveBase,
            diagnostic: 'edit.preview-diverged',
          }
        : { code: 'GeneralException', target: 'preview', diagnostic: 'edit.preview-diverged' }
    );
  }

  #set(status: DocumentPreviewStatus): void {
    if (this.#status === status || this.#status === 'ended') return;
    this.#status = status;
    for (const listener of [...this.#listeners]) {
      try {
        listener(status);
      } catch {
        /* a listener must never change what the preview does */
      }
    }
  }

  #end(): void {
    if (this.#status === 'ended') return;
    this.#unsubscribe?.();
    this.#unsubscribeEnd?.();
    this.fork.end();
    this.#set('ended');
    this.#listeners.clear();
  }
}

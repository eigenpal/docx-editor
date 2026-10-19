/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The runtime: one host, many runs.
//
// A runtime owns a document host and hands out request contexts. It is deliberately thin — the
// interesting rules are the context's — and it makes exactly three decisions:
//
// ROOTS ARE RESOLVED ONCE. The handles for the document and its body are the entry every object
// model starts from, and they are stable for the life of a host, so they are fetched once and
// cached. Eagerly, at construction, so that inside a run NOTHING reaches the host until
// `sync()`. A host with no document right now — a browser editor between mounts — simply fails
// that attempt, and the next run tries again; that is why the cache is "resolve on demand and
// keep", not "resolve in the constructor or die".
//
// RUNS ARE ISOLATED, NOT SERIALIZED. Every `run` gets its own context with its own queue, so two
// runs cannot interleave into one batch, and a run started inside another run works instead of
// waiting for a lock its own caller holds. Serializing runs would deadlock exactly there — the
// outer run cannot finish until the inner one does, and the inner one cannot start until the
// outer finishes — and "do not deadlock" is a harder requirement than "one run at a time".
// Batches themselves are serial regardless: `host.execute` is synchronous, so two contexts'
// batches are ordered by the order their `sync()` calls happen, and each is atomic on its own.
//
// DISPOSAL IS FINAL. `dispose()` releases the host once and is safe to call again; every later
// `run` or `save` fails `RuntimeDisposed` rather than reaching a host that no longer has a
// document.

import type {
  AutomationBatchRequest,
  AutomationBatchResponse,
  AutomationHandle,
  AutomationHost,
  AutomationOperation,
  HistoryGroup,
} from '@docx-editor.dev/core/automation';
import { isAutomationCommand } from '@docx-editor.dev/core/automation';
import { Document } from '../model/document.ts';
import { hostFailure } from './batch.ts';
import { ClientObject } from './client-object.ts';
import { DocxEditorError, fail } from './errors.ts';
import { hydratedHandle } from './hydrate.ts';
import type { RootHandles } from './internals.ts';
import { RequestContext, type RuntimeSession } from './request-context.ts';
import {
  openPreview,
  type DocumentPreview,
  type PreviewCallback,
  type PreviewPort,
} from './preview.ts';

/** What a `run` callback is given, and what it may answer with. */
export type RunCallback<T> = (context: RequestContext) => Promise<T>;

/**
 * Options for {@link DocxEditorRuntime.run}, passed before the callback.
 *
 * This is DocxEditor infrastructure, not part of the Office.js object model: the Office.js
 * `run` function has no options and no undo grouping.
 *
 * @example
 * ```ts
 * // One review decision, one undo step: the editor's writes and every sync of the run.
 * const decision = editor.beginHistoryGroup();
 * try {
 *   const resolved = editor.exec(
 *     { type: 'resolveAllReviewChanges', action: 'reject', keys },
 *     { historyGroup: decision }
 *   );
 *   if (!resolved.ok) throw new Error(resolved.reason);
 *   await runtime.run({ historyGroup: decision }, async (context) => {
 *     const ranges = context.document.body.search('30 days');
 *     ranges.load('items');
 *     await context.sync();
 *     const target = ranges.items[0];
 *     if (!target) throw new Error('The document has no "30 days" text.');
 *     const replaced = target.insertText('45 days', 'Replace');
 *     await context.sync();
 *     replaced.insertComment('Counter-proposal: 45 days.');
 *     await context.sync();
 *   });
 * } finally {
 *   decision.end();
 * }
 * ```
 * @public
 */
export interface RunOptions {
  /**
   * Make every write this run commits part of an open editor history group, so one undo
   * reverts them together with the group's other writes.
   *
   * Pass the handle `editor.beginHistoryGroup()` returns, unchanged.
   *
   * Browser runtime only. A server or collaborative runtime refuses the run with
   * `NotSupported` before the callback starts. To make one operation of a collaborative
   * server runtime one undo step, open `beginUndoGroup()` on its collaboration session.
   *
   * A closed handle, or a handle from another editor, refuses with `InvalidArgument` and
   * `target: 'historyGroup'` before the callback starts. A handle that closes during the run
   * refuses the next `context.sync()` the same way, and that sync writes nothing. Runs without
   * this option never join a group.
   *
   * The run has no `ExecResult`. The whole run is one write of the group: after the callback
   * finishes, `historyGroup.lastOutcome` holds its outcome, which is `split` if any sync split
   * the group. A split also emits the editor's `historyDiagnostic` event.
   */
  readonly historyGroup?: HistoryGroup;
  /** Objects a previous run tracked, adopted by this run. The same as the object argument. */
  readonly previousObjects?: ClientObject | readonly ClientObject[];
}

/** Capabilities exposed by a DocxEditor runtime, frozen for its lifetime. */
export interface DocumentCapabilities {
  /** There is a document to address at all. False for a browser host between mounts. */
  readonly document: boolean;
  /** `save()` is offered — true for a server runtime, false for one borrowing an editor. */
  readonly save: boolean;
  /** The host raises document events. */
  readonly events: boolean;
  /** The host has a user selection to read or move. */
  readonly selection: boolean;
  /** The host can be scrolled to a position. */
  readonly scrolling: boolean;
  /** The host lays the document out, so paginated positions are meaningful. */
  readonly layout: boolean;
  /**
   * `preview()` is offered: true for a runtime over a live browser editor, false for a server
   * runtime, which has no page to show a preview in.
   *
   * @example
   * ```ts
   * if (runtime.capabilities.preview) {
   *   const preview = await runtime.preview(counterProposal);
   * } else {
   *   await runtime.run(counterProposal); // write directly, for example on a server
   * }
   * ```
   */
  readonly preview: boolean;
}

/**
 * A runtime: one document host, many runs.
 *
 * Runs are ISOLATED, not serialized. Every {@link DocxEditorRuntime.run} gets its own context and
 * its own queue, so two runs cannot interleave into one batch, and a run started inside another
 * run works instead of waiting for a lock its own caller holds. Batches are still ordered — each
 * `sync()` commits writes atomically; read dependencies can use additional read-only batches.
 *
 * Disposal is final: {@link DocxEditorRuntime.dispose} releases the host once and is safe to call
 * again, and every later `run` fails with `RuntimeDisposed`.
 *
 * @public
 */
export interface DocxEditorRuntime {
  /** What the document host behind this runtime can do. Frozen at construction. */
  readonly capabilities: DocumentCapabilities;
  /** Run one batch of work against the document. Answers with the callback's value. */
  run<T>(callback: RunCallback<T>): Promise<T>;
  /** Run one batch of work, adopting objects a previous run tracked. */
  run<T>(object: ClientObject | readonly ClientObject[], callback: RunCallback<T>): Promise<T>;
  /**
   * Run one batch of work with options, such as an editor history group.
   *
   * @example
   * ```ts
   * const decision = editor.beginHistoryGroup();
   * await runtime.run({ historyGroup: decision }, async (context) => {
   *   context.document.body.insertParagraph('Revised terms follow.', 'End');
   *   await context.sync();
   * });
   * ```
   */
  run<T>(options: RunOptions, callback: RunCallback<T>): Promise<T>;
  /**
   * Show other wording in the page without writing it, until the answered preview is
   * committed or discarded.
   *
   * The callback gets an ordinary request context. Its reads and writes address a private
   * copy of the document, and the page paints that copy when the callback finishes. The live
   * document, its undo history, and every collaboration peer see nothing until
   * `preview.commit()`, which writes the preview as one undo step. This is DocxEditor
   * infrastructure; Office.js has no preview.
   *
   * The live editor stays editable while the callback runs; build the preview from data you
   * already have, because a write that lands meanwhile makes the preview start `stale`. Once
   * the preview shows, the editor refuses document writes: `editor.exec()` edits, typing,
   * undo and redo, and writes from any runtime, which refuse with `PreviewActive`. Zoom,
   * paragraph marks, the review pane toggle, and selection keep working. Reads from `run()` see
   * the live document; reads inside the preview callback see the preview. The review rail and
   * the editor's text highlights keep describing the live document, and the highlights are
   * hidden while the preview shows.
   *
   * In suggesting mode, a write the callback makes with tracking off becomes a suggestion
   * attributed to the editor's author, in the preview and at commit alike, as it does in
   * `run()`.
   *
   * Refusals, after each of which nothing is shown and nothing is written; `debugInfo.innerError`
   * names the reason:
   *
   * - `NotSupported` (target `preview`) on a server runtime, while the editor is open for
   *   viewing (`edit.read-only`), while an external refresh replaces the document
   *   (`edit.refresh-in-progress`), or during an input method composition
   *   (`edit.preview-composing`).
   * - `PreviewActive` (`edit.preview-active`) while another preview is open on the editor.
   * - `DocumentUnavailable` while the editor holds no mounted document.
   * - `NotSupported` (`edit.preview-unsupported`) from `context.sync()` for a write a preview
   *   cannot show: tables, pictures, fields, lists, hyperlinks, content controls, creating or
   *   deleting headers, footers, and notes, section and page setup, page and section breaks,
   *   and selection. Text edits in headers, footers, and notes show and commit.
   * - The same refusal `run()` would give for a write the live editor refuses: a protected
   *   range, a generated table of contents, a collaboration session that is not ready, or a
   *   comment outside the body (`edit.unsupported-story`). A preview never shows what its
   *   commit would refuse.
   * - Any error the callback throws. The preview ends, and the error propagates unchanged.
   *
   * @example
   * ```ts
   * const preview = await runtime.preview(async (context) => {
   *   context.document.changeTrackingMode = 'TrackMineOnly';
   *   const range = context.document.body.search('thirty (30) days of receipt').getFirst();
   *   range.insertText('forty-five (45) days of receipt', 'Replace');
   *   await context.sync();
   * });
   * preview.reveal();
   * // Later, from the review UI:
   * await preview.commit(); // or preview.discard()
   * ```
   */
  preview<T = void>(callback: PreviewCallback<T>): Promise<DocumentPreview<T>>;
  /** Release the host. Idempotent. */
  dispose(): void;
}

/**
 * A runtime over DOCX bytes rather than a live editor — what `DocxEditor.createServer` answers.
 *
 * Adds {@link DocxEditorServerRuntime.save} to the shared contract, because a server runtime owns
 * its document and can serialize it; a browser runtime borrows the editor's and cannot.
 *
 * @public
 */
export interface DocxEditorServerRuntime extends DocxEditorRuntime {
  /**
   * The current document as a fresh, caller-owned DOCX byte array.
   *
   * Mutating or transferring the returned array does not change this runtime or a later save.
   */
  save(): Promise<Uint8Array>;
}

/**
 * The tracked-revision view used by this runtime's ordinary Office-compatible text reads.
 *
 * `allMarkup` preserves the historical behavior. `original` matches Word's Original review view:
 * pending deletions remain visible and pending insertions stay hidden.
 *
 * This is a DocxEditor runtime option. It is not part of the Office.js object model.
 *
 * @public
 */
export type RevisionTextView = 'allMarkup' | 'original';

export interface CreateRuntimeOptions {
  readonly host: AutomationHost;
  /**
   * Whether this runtime offers `save()`.
   *
   * Not the same question as the host's `save` capability: a browser runtime borrows an editor
   * that owns its own saving, so the object model does not offer a second way to do it. When
   * this is true and the host reports the capability false, `save()` answers `NotSupported`.
   */
  readonly save: boolean;
  /**
   * Who a comment this runtime writes is recorded as.
   *
   * There is no signed-in user behind this API — a server has none, and the editor does not publish
   * one — and `CT_TrackChange` makes `@w:author` mandatory, so a reply written without one is
   * invalid XML rather than an anonymous remark. A runtime given no author refuses to enable tracking or write comments
   * (`NotSupported`) instead of inventing a name that would end up in the file.
   */
  readonly author?: string;
  /** Revision view for standard `text` loads and `search()` calls. Omitted means `allMarkup`. */
  readonly revisionTextView?: RevisionTextView;
  /** Told about each refused batch before it is thrown, for anonymous diagnostics. */
  readonly onRefusal?: (error: DocxEditorError, operations: readonly AutomationOperation[]) => void;
  /** Told about each batch that threw an engine error, for anonymous diagnostics. */
  readonly onException?: (error: unknown, operations: readonly AutomationOperation[]) => void;
  /**
   * The browser editor's preview fork. Only the browser runtime has one; without it
   * `preview()` refuses with `NotSupported`.
   */
  readonly preview?: PreviewPort & {
    /** Whether a preview is open on the editor, from any runtime. */
    active(): boolean;
  };
  /**
   * Runs a batch inside an editor history group, answering `null` for a handle that is not
   * open on the editor. Only the browser runtime has one; without it `historyGroup` refuses.
   */
  readonly historyGroups?: {
    /** One run's frames of `group`, or `null` when it is not an open handle of the editor. */
    begin(group: HistoryGroup): {
      execute(request: AutomationBatchRequest): AutomationBatchResponse | null;
      finish(): void;
    } | null;
  };
}

/** The pieces of a `run` call, whichever overload it used. */
function runArguments<T>(
  first: RunCallback<T> | RunOptions | ClientObject | readonly ClientObject[],
  second: RunCallback<T> | undefined
): {
  callback: RunCallback<T> | undefined;
  adopted: readonly ClientObject[];
  historyGroup: HistoryGroup | undefined;
} {
  const list = (value: ClientObject | readonly ClientObject[] | undefined) =>
    value === undefined ? [] : Array.isArray(value) ? value : [value as ClientObject];
  if (typeof first === 'function') return { callback: first, adopted: [], historyGroup: undefined };
  // Objects to adopt are proxies or arrays of them; any other object is options.
  if (first instanceof ClientObject || Array.isArray(first)) {
    return { callback: second, adopted: list(first as ClientObject), historyGroup: undefined };
  }
  if (first === null || typeof first !== 'object') fail({ code: 'InvalidArgument', target: 'run' });
  const options = first as RunOptions;
  return {
    callback: second,
    adopted: list(options.previousObjects),
    historyGroup: options.historyGroup,
  };
}

/** The host a grouped run's context sends its batches through. */
function groupedHost(
  host: AutomationHost,
  run: { execute(request: AutomationBatchRequest): AutomationBatchResponse | null }
): AutomationHost {
  return {
    ...host,
    execute(request) {
      const response = run.execute(request);
      if (response === null) fail({ code: 'InvalidArgument', target: 'historyGroup' });
      return response;
    },
  };
}

export function createRuntime(
  options: CreateRuntimeOptions & { save: true }
): DocxEditorServerRuntime;
export function createRuntime(options: CreateRuntimeOptions): DocxEditorRuntime;
export function createRuntime(options: CreateRuntimeOptions): DocxEditorServerRuntime {
  const host = options.host;
  const capabilities: DocumentCapabilities = Object.freeze({
    ...host.capabilities,
    save: options.save && host.capabilities.save,
    preview: options.preview !== undefined,
  });
  // Trimmed once here, as the engine trims it before it writes `w:author`, so every reader of
  // the runtime's author, such as the agent entry's author hook, sees the name the file records.
  const author =
    typeof options.author === 'string' && options.author.trim().length > 0
      ? options.author.trim()
      : undefined;
  const revisionTextView = options.revisionTextView ?? 'allMarkup';
  if (revisionTextView !== 'allMarkup' && revisionTextView !== 'original') {
    fail({ code: 'InvalidArgument', target: 'revisionTextView' });
  }
  let disposed = false;
  let roots: RootHandles | null = null;

  const assertLive = (target?: string): void => {
    if (disposed) fail({ code: 'RuntimeDisposed', ...(target === undefined ? {} : { target }) });
  };

  /**
   * Ask the host to name the document and its body.
   *
   * Two batches, because the second operation needs the first one's answer as data — a handle is
   * a value in a request, not a placeholder the host resolves. This is the only place in the
   * runtime that sends anything outside a `sync()`, and it happens once per host.
   */
  const resolveRoots = (): RootHandles => {
    if (roots) return roots;
    assertLive('document');
    roots = rootsOn(host);
    return roots;
  };
  /** The document and body handles `on` answers. Two batches; see `resolveRoots`. */
  const rootsOn = (on: AutomationHost): RootHandles => {
    const execute = (operations: AutomationOperation[]) => {
      try {
        return on.execute({ operations });
      } catch (error) {
        // An engine error, not a refusal: reported like one inside a batch, then rethrown.
        try {
          options.onException?.(error, operations);
        } catch {
          /* an observer must never change what the caller sees */
        }
        throw error;
      }
    };
    const document = firstHandle(execute([{ op: 'getDocument' }]), 'document');
    const body = firstHandle(execute([{ op: 'getBody', document }]), 'document.body');
    return { document, body };
  };

  const session: RuntimeSession = {
    host,
    capabilities,
    ...(author === undefined ? {} : { author }),
    revisionTextView,
    ...(options.onRefusal ? { onRefusal: options.onRefusal } : {}),
    ...(options.onException ? { onException: options.onException } : {}),
    id: {},
    roots: resolveRoots,
    assertLive,
    openDocument: (context) => Document.open(context),
  };

  /**
   * Refuse a write while a preview is open, before it reaches the editor: the editor would
   * refuse it too, but only this runtime can name the reason `PreviewActive`.
   */
  const previewGuard = (on: AutomationHost): AutomationHost => {
    const preview = options.preview;
    if (!preview) return on;
    return {
      ...on,
      execute(request) {
        if (preview.active() && request.operations.some((op) => isAutomationCommand(op))) {
          fail({ code: 'PreviewActive', diagnostic: 'edit.preview-active' });
        }
        return on.execute(request);
      },
    };
  };
  const guardedSession: RuntimeSession = options.preview
    ? { ...session, host: previewGuard(host) }
    : session;

  /** A run over a preview's fork: its own roots, its own adoption identity, its own host. */
  const runOn = async <T>(on: AutomationHost, callback: PreviewCallback<T>): Promise<T> => {
    let forkRoots: RootHandles | null = null;
    const { context, finish } = RequestContext.begin({
      ...session,
      host: on,
      capabilities: Object.freeze({ ...on.capabilities, preview: false }),
      id: {},
      roots: () => (forkRoots ??= rootsOn(on)),
    });
    try {
      return await callback(context);
    } finally {
      finish();
    }
  };

  const previews = new Set<DocumentPreview<unknown>>();
  async function preview<T>(callback: PreviewCallback<T>): Promise<DocumentPreview<T>> {
    assertLive('preview');
    if (typeof callback !== 'function') fail({ code: 'InvalidArgument', target: 'preview' });
    const port = options.preview;
    // Infrastructure with no Office.js equivalent: refused, never approximated, where the host
    // has no page to show it in.
    if (!port) fail({ code: 'NotSupported', target: 'preview' });
    const opened = await openPreview(
      {
        port,
        host,
        ...(author === undefined ? {} : { author }),
        groupRun: (group) => options.historyGroups?.begin(group) ?? null,
        runOn,
      },
      callback
    );
    // A disposed runtime must not leave the editor showing a preview that refuses its writes.
    previews.add(opened);
    opened.onStatusChanged((status) => {
      if (status === 'ended') previews.delete(opened);
    });
    return opened;
  }

  // Best effort at construction: with the roots already known, a run reaches the host only when
  // the consumer calls `sync()`. A host that has no document yet is not an error here — the
  // first run that needs the roots asks again.
  try {
    resolveRoots();
  } catch {
    roots = null;
  }

  async function run<T>(
    first: RunCallback<T> | RunOptions | ClientObject | readonly ClientObject[],
    second?: RunCallback<T>
  ): Promise<T> {
    assertLive();
    const { callback, adopted, historyGroup } = runArguments(first, second);
    if (typeof callback !== 'function') fail({ code: 'InvalidArgument', target: 'run' });
    let runSession = guardedSession;
    let groupRun: ReturnType<NonNullable<CreateRuntimeOptions['historyGroups']>['begin']> = null;
    if (historyGroup !== undefined) {
      // Infrastructure with no Office.js equivalent: refused, never approximated, where the
      // host has no editor history to join.
      if (!options.historyGroups) fail({ code: 'NotSupported', target: 'historyGroup' });
      groupRun = options.historyGroups.begin(historyGroup);
      if (groupRun === null) fail({ code: 'InvalidArgument', target: 'historyGroup' });
      runSession = { ...session, host: previewGuard(groupedHost(host, groupRun)) };
    }

    const { context, adopt, finish } = RequestContext.begin(runSession);
    try {
      adopt(adopted);
      return await callback(context);
    } finally {
      finish();
      // The run is one write of the group: it settles once, after its last sync.
      groupRun?.finish();
    }
  }

  const runtime: DocxEditorRuntime = {
    capabilities,
    run,
    preview,
    dispose() {
      if (disposed) return;
      disposed = true;
      roots = null;
      for (const open of [...previews]) open.discard();
      host.dispose();
    },
  };
  if (!options.save) return runtime as DocxEditorServerRuntime;

  // `save` is ADDED, not present-and-refusing. A browser runtime borrows an editor that owns its
  // own saving, and a method that exists only to throw invites consumers to call it and handle
  // the failure — which is a worse API than not having it.
  const saving: DocxEditorServerRuntime = {
    ...runtime,
    async save(): Promise<Uint8Array> {
      assertLive('save');
      if (!capabilities.save) fail({ code: 'NotSupported', target: 'save' });
      const saved = host.save();
      if (!saved.ok) throw hostFailure(saved.error, { target: 'save' });
      return saved.bytes;
    },
  };
  return saving;
}

/**
 * The one handle a root-resolution batch was for.
 *
 * Root resolution is the only exchange in the runtime that is not a queued action, so it cannot
 * borrow the queue's positional hydration; this is the same reading, done once, by hand.
 */
function firstHandle(response: AutomationBatchResponse, target: string): AutomationHandle {
  const result = response.results[0];
  if (result?.status === 'error') throw hostFailure(result.error, { target });
  if (result?.status !== 'ok') throw new DocxEditorError({ code: 'GeneralException', target });
  return hydratedHandle(result.value, target);
}

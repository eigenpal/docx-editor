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
  AutomationBatchResponse,
  AutomationHandle,
  AutomationHost,
} from '@docx-editor.dev/core/automation';
import { Document } from '../model/document.ts';
import { hostFailure } from './batch.ts';
import type { ClientObject } from './client-object.ts';
import { DocxEditorError, fail } from './errors.ts';
import { hydratedHandle } from './hydrate.ts';
import type { RootHandles } from './internals.ts';
import { RequestContext, type RuntimeSession } from './request-context.ts';

/** What a `run` callback is given, and what it may answer with. */
export type RunCallback<T> = (context: RequestContext) => Promise<T>;

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
}

/**
 * A runtime: one document host, many runs.
 *
 * Runs are ISOLATED, not serialized. Every {@link DocxEditorRuntime.run} gets its own context and
 * its own queue, so two runs cannot interleave into one batch, and a run started inside another
 * run works instead of waiting for a lock its own caller holds. Batches are still ordered — each
 * `sync()` sends one atomic batch, in the order the `sync()` calls happen.
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
 * `all` preserves the historical behavior. `vanilla` keeps pending deletions visible and hides
 * pending insertions, so text returned to an agent remains a valid edit anchor.
 *
 * @public
 */
export type RevisionTextView = 'all' | 'vanilla';

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
   * invalid XML rather than an anonymous remark. A runtime given no author refuses to write comments
   * (`NotSupported`) instead of inventing a name that would end up in the file.
   */
  readonly author?: string;
  /** Revision view for standard `text` loads and `search()` calls. Omitted means `all`. */
  readonly revisionTextView?: RevisionTextView;
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
  });
  const author =
    typeof options.author === 'string' && options.author.trim().length > 0
      ? options.author
      : undefined;
  const revisionTextView = options.revisionTextView ?? 'all';
  if (revisionTextView !== 'all' && revisionTextView !== 'vanilla') {
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
    const document = firstHandle(host.execute({ operations: [{ op: 'getDocument' }] }), 'document');
    const body = firstHandle(
      host.execute({ operations: [{ op: 'getBody', document }] }),
      'document.body'
    );
    roots = { document, body };
    return roots;
  };

  const session: RuntimeSession = {
    host,
    capabilities,
    ...(author === undefined ? {} : { author }),
    revisionTextView,
    id: {},
    roots: resolveRoots,
    assertLive,
    openDocument: (context) => Document.open(context),
  };

  // Best effort at construction: with the roots already known, a run reaches the host only when
  // the consumer calls `sync()`. A host that has no document yet is not an error here — the
  // first run that needs the roots asks again.
  try {
    resolveRoots();
  } catch {
    roots = null;
  }

  async function run<T>(
    first: RunCallback<T> | ClientObject | readonly ClientObject[],
    second?: RunCallback<T>
  ): Promise<T> {
    assertLive();
    const callback = typeof first === 'function' ? (first as RunCallback<T>) : second;
    const adopted: readonly ClientObject[] =
      typeof first === 'function'
        ? []
        : Array.isArray(first)
          ? (first as readonly ClientObject[])
          : [first as ClientObject];
    if (typeof callback !== 'function') fail({ code: 'InvalidArgument', target: 'run' });

    const { context, adopt, finish } = RequestContext.begin(session);
    try {
      adopt(adopted);
      return await callback(context);
    } finally {
      finish();
    }
  }

  const runtime: DocxEditorRuntime = {
    capabilities,
    run,
    dispose() {
      if (disposed) return;
      disposed = true;
      roots = null;
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

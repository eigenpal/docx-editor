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
} from '@docx-editor.dev/core-contract/automation';
import { hostFailure } from './batch.ts';
import type { ClientObject } from './client-object.ts';
import { DocxEditorError, fail } from './errors.ts';
import { hydratedHandle } from './hydrate.ts';
import type { RootHandles } from './internals.ts';
import { RequestContext, type RuntimeSession } from './request-context.ts';

/** What a `run` callback is given, and what it may answer with. */
export type RunCallback<T> = (context: RequestContext) => Promise<T>;

export interface DocxEditorRuntime {
  /** What the document host behind this runtime can do. Frozen at construction. */
  readonly capabilities: AutomationHost['capabilities'];
  /** Run one batch of work against the document. Answers with the callback's value. */
  run<T>(callback: RunCallback<T>): Promise<T>;
  /** Run one batch of work, adopting objects a previous run tracked. */
  run<T>(object: ClientObject | readonly ClientObject[], callback: RunCallback<T>): Promise<T>;
  /** Release the host. Idempotent. */
  dispose(): void;
}

export interface DocxEditorServerRuntime extends DocxEditorRuntime {
  /** The current document as DOCX bytes. */
  save(): Promise<Uint8Array>;
}

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
}

export function createRuntime(
  options: CreateRuntimeOptions & { save: true }
): DocxEditorServerRuntime;
export function createRuntime(options: CreateRuntimeOptions): DocxEditorRuntime;
export function createRuntime(options: CreateRuntimeOptions): DocxEditorServerRuntime {
  const host = options.host;
  const capabilities = host.capabilities;
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
    id: {},
    roots: resolveRoots,
    assertLive,
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

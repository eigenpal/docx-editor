// The context a `run` hands to its callback: one queue, one document, one sync at a time.
//
// `sync()` is the only thing in this runtime that talks to the document, and it does so exactly
// once per call: plan the queued actions in order, send ONE batch, hydrate the answers. That is
// where atomicity comes from — the host commits every command in a batch as one transaction, so
// a batch either happens whole or not at all, and the runtime never splits a consumer's `sync()`
// into several batches behind their back.
//
// CONDITIONAL WRITES. A context that has read from the document remembers the revision it read
// at, and a later batch that writes is sent conditional on that revision. This is what stops a
// decision made from a cached read being applied to a document that has since moved — the case
// the whole read-decide-write shape of a batching API invites. A context that has not read
// anything has nothing to be stale about, so its writes go out unconditionally, which is what an
// unconditional command wants.
//
// EACH CONTEXT IS ITS OWN. Two runs on one runtime never share a queue, so their actions cannot
// interleave into one batch however their awaits happen to schedule. See `runtime.ts` for why
// that isolation — rather than serializing runs — is the answer for nesting.

import type {
  AutomationBatchRequest,
  AutomationCapabilities,
  AutomationHost,
} from '@docx-editor.dev/core-contract/automation';
import { batchFailure, planBatch, settleBatch } from './batch.ts';
import type { ClientObject } from './client-object.ts';
import { DocxEditorError, fail } from './errors.ts';
import {
  INTERNALS,
  REBIND,
  RELEASE,
  type ContextInternals,
  type RootHandles,
} from './internals.ts';
import { ActionQueue } from './queue.ts';
import { TrackedObjects } from './tracked-objects.ts';

/** What a context needs from the runtime that made it. */
export interface RuntimeSession {
  readonly host: AutomationHost;
  readonly capabilities: AutomationCapabilities;
  /** Identity for adoption checks. The session object itself. */
  readonly id: object;
  roots(): RootHandles;
  /** Refuse if the runtime has been disposed. */
  assertLive(target?: string): void;
}

export class RequestContext {
  readonly #session: RuntimeSession;
  readonly #queue = new ActionQueue();
  readonly #created = new Set<ClientObject>();
  readonly #tracked = new Set<ClientObject>();
  readonly #internals: ContextInternals;
  readonly #trackedObjects: TrackedObjects;
  #finished = false;
  /** The revision this context last saw. `null` until it has read from the document. */
  #readRevision: number | null = null;

  private constructor(session: RuntimeSession) {
    this.#session = session;
    this.#internals = {
      host: session.host,
      capabilities: session.capabilities,
      queue: this.#queue,
      session: session.id,
      roots: () => session.roots(),
      assertUsable: (target?: string) => {
        this.#session.assertLive(target);
        if (this.#finished) {
          fail({
            code: 'InvalidRequestContext',
            ...(target === undefined ? {} : { target }),
          });
        }
      },
      register: (object) => {
        this.#created.add(object as ClientObject);
      },
      track: (object) => {
        this.#tracked.add(object as ClientObject);
      },
      untrack: (object) => {
        this.#tracked.delete(object as ClientObject);
      },
      isTracked: (object) => this.#tracked.has(object as ClientObject),
    };
    this.#trackedObjects = new TrackedObjects(this.#internals, (object) =>
      this.#created.has(object)
    );
  }

  /** What the document host behind this context can do. */
  get capabilities(): AutomationCapabilities {
    return this.#session.capabilities;
  }

  get trackedObjects(): TrackedObjects {
    return this.#trackedObjects;
  }

  /**
   * Send everything queued as one batch and hydrate the answers.
   *
   * An empty queue is not a round trip. Office-shaped code syncs defensively at the end of a
   * batch, and turning "nothing to say" into a host call would make a no-op sync advance a
   * revision and fire a change event for nobody.
   */
  async sync(): Promise<void> {
    this.#internals.assertUsable();
    const actions = this.#queue.take();
    if (actions.length === 0) return;

    const planned = planBatch(actions);
    const conditional = planned.hasWrite && this.#readRevision !== null;
    const expectedRevision = conditional ? (this.#readRevision as number) : undefined;
    const request: AutomationBatchRequest = {
      operations: planned.operations,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    };

    const response = this.#session.host.execute(request);
    if (!response.ok) throw batchFailure(response, actions, expectedRevision);
    settleBatch(actions, response);
    if (planned.hasRead || planned.hasWrite) this.#readRevision = response.revision;
  }

  /** @internal The seam proxies reach the context through. */
  get [INTERNALS](): ContextInternals {
    return this.#internals;
  }

  /** @internal Only `run` may build one, and only `run` may end one. */
  static begin(session: RuntimeSession): {
    context: RequestContext;
    adopt: (objects: readonly ClientObject[]) => void;
    finish: () => void;
  } {
    const context = new RequestContext(session);
    return {
      context,
      adopt(objects) {
        for (const object of objects) context.#adopt(object);
      },
      finish() {
        context.#finish();
      },
    };
  }

  /**
   * Take over an object a previous run tracked.
   *
   * The two refusals are the whole point of adoption being explicit. An object from another
   * runtime names a document this host never opened — its handles would resolve against the
   * wrong document, or not at all. An object that was released has already had its lifetime
   * applied, and reviving it would make `trackedObjects` advisory.
   */
  #adopt(object: ClientObject): void {
    const internals = object.context[INTERNALS];
    if (internals.session !== this.#session.id) {
      throw new DocxEditorError({ code: 'InvalidObjectPath' });
    }
    if (!internals.isTracked(object)) {
      throw new DocxEditorError({ code: 'InvalidObjectPath' });
    }
    object[REBIND](this);
    this.#created.add(object);
    this.#tracked.add(object);
  }

  /**
   * End of the run.
   *
   * Queued actions are DROPPED, never flushed: a callback that returned without syncing did not
   * ask for its writes to happen, and a callback that threw certainly did not. Then every object
   * this context made is released except the ones tracking kept.
   */
  #finish(): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#queue.clear();
    for (const object of this.#created) {
      if (this.#tracked.has(object)) continue;
      object[RELEASE]();
    }
    this.#created.clear();
  }
}

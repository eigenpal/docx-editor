/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
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
// unconditional command wants. Adopting an object counts as having read: its loaded state came
// from some revision, and the run that writes from it is the one that has to be conditional.
//
// EACH CONTEXT IS ITS OWN. Two runs on one runtime never share a queue, so their actions cannot
// interleave into one batch however their awaits happen to schedule. See `runtime.ts` for why
// that isolation — rather than serializing runs — is the answer for nesting.

import type {
  AutomationBatchRequest,
  AutomationCapabilities,
  AutomationHost,
} from '@docx-editor.dev/core-contract/automation';
import type { Document } from '../model/document.ts';
import { batchFailure, planBatch, settleBatch } from './batch.ts';
import type { ClientObject } from './client-object.ts';
import { DocxEditorError, fail } from './errors.ts';
import type { DocumentCapabilities } from './runtime.ts';
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
  /** Who a comment this runtime writes is recorded as, or absent when it may not write one. */
  readonly author?: string;
  /** Identity for adoption checks. The session object itself. */
  readonly id: object;
  roots(): RootHandles;
  /** Refuse if the runtime has been disposed. */
  assertLive(target?: string): void;
  /**
   * Build the document proxy for a context.
   *
   * Injected rather than imported, so this module does not depend on the object model that
   * depends on it. The runtime composes the two; the context only knows it can ask for one.
   */
  openDocument(context: RequestContext): Document;
}

export class RequestContext {
  readonly #session: RuntimeSession;
  readonly #queue = new ActionQueue();
  readonly #created = new Set<ClientObject>();
  readonly #tracked = new Set<ClientObject>();
  readonly #internals: ContextInternals;
  readonly #trackedObjects: TrackedObjects;
  #document: Document | undefined;
  #finished = false;
  /** The revision this context last saw. `null` until it has read from the document. */
  #readRevision: number | null = null;

  private constructor(session: RuntimeSession) {
    this.#session = session;
    this.#internals = {
      host: session.host,
      capabilities: session.capabilities,
      ...(session.author === undefined ? {} : { author: session.author }),
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
      isFinished: () => this.#finished,
      readRevision: () => this.#readRevision,
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
      disown: (object) => {
        this.#created.delete(object as ClientObject);
        this.#tracked.delete(object as ClientObject);
      },
    };
    this.#trackedObjects = new TrackedObjects(this.#internals, (object) =>
      this.#created.has(object)
    );
  }

  /**
   * The document this run is against.
   *
   * The SAME object for the life of the context, like every navigation property in this API: a
   * consumer who loads `context.document.body` and then reads its text is talking about one
   * object, and a fresh proxy per access would put the load on one and the read on another.
   */
  get document(): Document {
    this.#internals.assertUsable('document');
    this.#document ??= this.#session.openDocument(this);
    return this.#document;
  }

  /** What the document host behind this context can do. */
  get capabilities(): DocumentCapabilities {
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
   * Take over an object a PREVIOUS run tracked.
   *
   * Three refusals, and adoption is explicit so that each of them can happen here rather than as
   * something strange later:
   *
   * ANOTHER RUNTIME. Its handles name a document this host never opened, so they would resolve
   * against the wrong document or not at all.
   *
   * A RUN STILL IN FLIGHT. The object is that run's, and rebinding it would send that run's next
   * call into this context's queue — two runs' work in one batch, which is precisely what a
   * context per run exists to prevent — while leaving two registries claiming its lifetime. So the
   * handover waits for the owner to finish, and nothing about the object moves in the meantime.
   *
   * NOT TRACKED. A released object has already had its lifetime applied, and reviving it would
   * make `trackedObjects` advisory.
   *
   * A successful handover is a MOVE: the source gives up its claims, this context takes them, and
   * the revision the source had read at comes along — the object's loaded state was read then, and
   * a write computed from it has to be conditional on that, not on whatever the document is at by
   * the time this run writes.
   */
  #adopt(object: ClientObject): void {
    const source = object.context;
    // Already ours: `run([kept, kept], ...)` asks for one handover, not a second from itself.
    if (source === this) return;

    const internals = source[INTERNALS];
    if (internals.session !== this.#session.id) {
      throw new DocxEditorError({ code: 'InvalidObjectPath' });
    }
    // Before the tracking check: an object whose run is still going has not been released,
    // whatever it is or is not tracked by, so `InvalidObjectPath` would be the wrong answer.
    if (!internals.isFinished()) {
      throw new DocxEditorError({ code: 'ObjectInUse' });
    }
    if (!internals.isTracked(object)) {
      throw new DocxEditorError({ code: 'InvalidObjectPath' });
    }

    const carried = internals.readRevision();
    internals.disown(object);
    object[REBIND](this);
    this.#created.add(object);
    this.#tracked.add(object);
    if (carried !== null) this.#carryRead(carried);
  }

  /**
   * Inherit a revision an adopted object's state was read at.
   *
   * The OLDEST of them when several objects are adopted: a batch is conditional on one revision,
   * and the newest would let a decision made from the oldest object's state be applied to a
   * document that had moved past it — the exact thing being prevented.
   */
  #carryRead(revision: number): void {
    this.#readRevision =
      this.#readRevision === null ? revision : Math.min(this.#readRevision, revision);
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

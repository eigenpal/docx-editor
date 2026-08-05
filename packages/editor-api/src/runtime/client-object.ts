/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The base every document proxy is.
//
// A proxy is three things and no more: the context it belongs to, the path that says whether it
// can be addressed, and the properties a completed `load` filled in. Everything a subclass adds
// is expressed through the four protected helpers below, which is what keeps one set of rules —
// when a call is refused, when a read is refused, what a released object does — from being
// re-decided per object in the model that follows.
//
// LOADED VALUES LIVE IN A MAP. Not on the instance, and not on a plain object used as a
// dictionary: property names reaching `load(...)` can come from a consumer's own data, and a
// name like `__proto__` assigned into an object is the prototype-pollution hazard the repository
// audits for. A `Map` has no such key, so the whole class of problem is absent rather than
// filtered.
//
// A RELEASED PROXY STILL ANSWERS WHAT IT ALREADY KNEW. Reading a property that was loaded before
// the run ended is served from the map, because that value is a copy the consumer already has —
// it is not a reach into a document. Anything that would talk to the document (`load`, a write,
// a method) refuses with `InvalidObjectPath`. The line is "does this need the document", not
// "does this look like a read".

import type { AutomationHandle } from '@docx-editor.dev/core-contract/automation';
import { fail } from './errors.ts';
import {
  INTERNALS,
  REBIND,
  RELEASE,
  type ContextInternals,
  type RuntimeManagedObject,
} from './internals.ts';
import { resolveLoadOption, type LoadOption, type ResolvedLoadOptions } from './load-options.ts';
import type { ObjectPath } from './object-path.ts';
import type { QueuedAction } from './queue.ts';
import type { RequestContext } from './request-context.ts';

export abstract class ClientObject implements RuntimeManagedObject {
  #context: RequestContext;
  #internals: ContextInternals;
  readonly #path: ObjectPath;
  readonly #nullable: boolean;
  readonly #loaded = new Map<string, unknown>();

  protected constructor(
    context: RequestContext,
    path: ObjectPath,
    options: { readonly nullable?: boolean } = {}
  ) {
    this.#context = context;
    this.#internals = context[INTERNALS];
    this.#path = path;
    this.#nullable = options.nullable === true;
    this.#internals.register(this);
  }

  /** The context this object currently belongs to. */
  get context(): RequestContext {
    return this.#context;
  }

  /**
   * Whether this object turned out not to exist.
   *
   * Only ever an answer, never a guess: an object that came from a `getItemOrNullObject` has no
   * verdict until the sync that looked for it, and reading one before then is
   * `PropertyNotLoaded` rather than a plausible `false`. Objects that are not "or null" are
   * never null, so they answer immediately.
   */
  get isNullObject(): boolean {
    if (this.#path.isReleased) fail({ code: 'InvalidObjectPath', target: this.#path.label });
    if (!this.#nullable) return false;
    if (this.#path.isPending) {
      fail({ code: 'PropertyNotLoaded', target: `${this.#path.label}.isNullObject` });
    }
    return this.#path.isNull;
  }

  /**
   * Queue the reads that fill in the selected properties.
   *
   * Returns `this` so a load can be chained, and queues rather than fetches: the values are
   * readable after the next `sync()`, and reading before then is `PropertyNotLoaded`.
   */
  load(option?: LoadOption): this {
    this.requireAddressable();
    this.onLoad(resolveLoadOption(option, this.#path.label));
    return this;
  }

  /** What this kind of object does with a resolved load request. */
  protected abstract onLoad(request: ResolvedLoadOptions): void;

  protected get path(): ObjectPath {
    return this.#path;
  }

  protected get internals(): ContextInternals {
    return this.#internals;
  }

  /** The handle to address this object with, or `InvalidObjectPath`. */
  protected handle(): AutomationHandle {
    return this.#path.handle();
  }

  /**
   * The check every call that talks to the document makes first.
   *
   * At the CALL, not at the sync: a consumer who writes to an object whose run has ended has
   * made the mistake already, and reporting it three lines later at `sync()` describes it as a
   * batch failure instead of as the bad call it was.
   *
   * THE OBJECT IS ASKED ABOUT BEFORE ITS CONTEXT, and the order is the answer to a real
   * question: an untracked object outside its run is BOTH released and holding a finished
   * context. `InvalidObjectPath` is the useful half — the object itself is gone, and no amount
   * of starting another run brings it back — whereas a tracked object in the same position is
   * perfectly good and only needs adopting, which is what `InvalidRequestContext` says.
   */
  protected requireAddressable(): void {
    if (!this.#path.isAddressable) fail({ code: 'InvalidObjectPath', target: this.#path.label });
    this.#internals.assertUsable(this.#path.label);
  }

  protected enqueue(action: QueuedAction): void {
    this.requireAddressable();
    this.#internals.queue.push(action);
  }

  protected loadedProperty<T>(name: string): T {
    if (this.#path.isReleased && !this.#loaded.has(name)) {
      fail({ code: 'InvalidObjectPath', target: this.#path.label });
    }
    if (!this.#loaded.has(name)) {
      fail({ code: 'PropertyNotLoaded', target: `${this.#path.label}.${name}` });
    }
    return this.#loaded.get(name) as T;
  }

  protected hasLoadedProperty(name: string): boolean {
    return this.#loaded.has(name);
  }

  protected setLoadedProperty(name: string, value: unknown): void {
    this.#loaded.set(name, value);
  }

  /** @internal */
  [RELEASE](): void {
    this.#path.release();
  }

  /** @internal */
  [REBIND](context: RequestContext): void {
    this.#context = context;
    this.#internals = context[INTERNALS];
  }
}

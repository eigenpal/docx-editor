/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Deliberate object lifetime.
//
// The default is that a proxy dies with the run that made it, and that default is the safe one:
// a document object is a reference into a document that keeps changing, and code that holds one
// indefinitely is code whose reference quietly stops meaning what it meant. So keeping one alive
// is something a consumer has to ASK for, by name, on the context that owns it.
//
// `add` is not a cache and not a copy. It says: when this run ends, do not release this object —
// I intend to hand it to another `run` on this runtime. `remove` withdraws that intent, and the
// object goes back to being released when the run ends. Both are idempotent, because "make sure
// this is tracked" is a reasonable thing to say twice and turning the second one into an error
// would only teach consumers to guard every call.

import type { ClientObject } from './client-object.ts';
import { fail } from './errors.ts';
import type { ContextInternals } from './internals.ts';

function each(
  object: ClientObject | readonly ClientObject[],
  visit: (one: ClientObject) => void
): void {
  if (Array.isArray(object)) {
    for (const one of object as readonly ClientObject[]) visit(one);
    return;
  }
  visit(object as ClientObject);
}

/**
 * The objects a context keeps addressable beyond the run that created them.
 *
 * An ordinary proxy stops being usable when its run ends. Tracking one keeps its address alive so
 * a later `run(object, callback)` can adopt it, and untracking releases it — which matters for
 * long-lived callers, since a tracked object is a document reference that will not be collected
 * on its own.
 *
 * @public
 */
export class TrackedObjects {
  readonly #internals: ContextInternals;
  readonly #owns: (object: ClientObject) => boolean;

  /** @internal Built by the static factories above, never directly. */
  constructor(internals: ContextInternals, owns: (object: ClientObject) => boolean) {
    this.#internals = internals;
    this.#owns = owns;
  }

  /** Keep these objects usable after this run ends. */
  add(object: ClientObject | readonly ClientObject[]): void {
    this.#internals.assertUsable();
    each(object, (one) => {
      this.#require(one);
      this.#internals.track(one);
    });
  }

  /** Stop keeping them: they are released when this run ends, like any other object. */
  remove(object: ClientObject | readonly ClientObject[]): void {
    this.#internals.assertUsable();
    each(object, (one) => {
      this.#require(one);
      this.#internals.untrack(one);
    });
  }

  /**
   * Refuse an object this context does not own.
   *
   * A context can only speak for its own objects: tracking one from another run would leave two
   * registries claiming the same lifetime, and tracking one from another RUNTIME would name a
   * document this host never opened.
   */
  #require(object: ClientObject): void {
    if (!this.#owns(object)) {
      fail({ code: 'InvalidObjectPath' });
    }
  }
}

// The seam between a request context and the proxies it owns.
//
// A proxy has to reach its context's queue, its host and its object registry; a context has to
// release and re-bind proxies. Neither of those is anything a consumer should be able to do, and
// both would be plainly public if they were ordinary methods on classes this package exports.
//
// So the seam is symbol-keyed. `INTERNALS`, `RELEASE` and `REBIND` are not exported from the
// package entry, which makes them unreachable from outside this package without deliberately
// importing a module the entry does not advertise — while remaining ordinary property access
// inside it, so the object model in later slices needs no privileged construction.
//
// This module imports nothing at runtime. It is the one place both sides of the seam can depend
// on without the context and the proxy base importing each other.

import type {
  AutomationCapabilities,
  AutomationHandle,
  AutomationHost,
} from '@docx-editor.dev/core-contract/automation';
import type { ActionQueue } from './queue.ts';
import type { RequestContext } from './request-context.ts';

export const INTERNALS: unique symbol = Symbol('docx-editor.runtime.internals');
export const RELEASE: unique symbol = Symbol('docx-editor.runtime.release');
export const REBIND: unique symbol = Symbol('docx-editor.runtime.rebind');

/** The handles every object model starts from. Resolved once per runtime. */
export interface RootHandles {
  readonly document: AutomationHandle;
  readonly body: AutomationHandle;
}

/** What a proxy may ask of the context it belongs to. */
export interface ContextInternals {
  readonly host: AutomationHost;
  readonly capabilities: AutomationCapabilities;
  readonly queue: ActionQueue;
  /**
   * Identity of the runtime session behind this context.
   *
   * Compared, never called: it is how `run(object, ...)` refuses to adopt an object minted by a
   * different runtime, whose handles name a document this host never opened.
   */
  readonly session: object;
  roots(): RootHandles;
  /**
   * Refuse if this context can no longer be used — its run finished, or the runtime was
   * disposed. `target` names the object or property the caller was reaching for.
   */
  assertUsable(target?: string): void;
  /**
   * Whether this context's run has ended.
   *
   * Narrower than `assertUsable`, and asked by adoption for a reason: a LIVE context's objects are
   * still its own, and taking one would interleave that run's next call into another run's batch.
   */
  isFinished(): boolean;
  /** The revision this context last read at, or `null` if it has never read. */
  readRevision(): number | null;
  register(object: RuntimeManagedObject): void;
  track(object: RuntimeManagedObject): void;
  untrack(object: RuntimeManagedObject): void;
  isTracked(object: RuntimeManagedObject): boolean;
  /**
   * Give up every claim on an object: it belongs to another context now.
   *
   * The other half of a rebind. Without it the object would still be in this context's registries
   * — two owners for one lifetime, one of which could release it out from under the other.
   */
  disown(object: RuntimeManagedObject): void;
}

/** What a context may do to a proxy it owns. */
export interface RuntimeManagedObject {
  [RELEASE](): void;
  /** Adoption: this object now belongs to another run's context on the same runtime. */
  [REBIND](context: RequestContext): void;
}

/** The internals of a context, for the modules that hold one. */
export function internalsOf(context: RequestContext): ContextInternals {
  return context[INTERNALS];
}

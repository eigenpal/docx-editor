// How a proxy names the document object it stands for.
//
// The host addresses objects by opaque handles it minted, and a handle is DATA in a batch
// request — so an operation's target must be known before the batch is sent. That single fact
// decides this whole file: a proxy is addressable when it holds a handle, and a proxy that does
// not hold one yet cannot be the target of an operation in the batch that is about to go out.
// It becomes addressable when a read in some batch hands it a handle.
//
// The consequence is deliberate and documented: `load`/`sync` is what turns a promised object
// into an addressable one, so reaching a paragraph takes one sync before writing to it. The
// alternative — resolving chained paths by quietly sending several batches per `sync()` — would
// trade the property this runtime exists to guarantee (one sync is one atomic batch) for
// syntactic convenience.
//
// A path also carries its LABEL: the consumer-facing name of the object (`document.body`,
// `document.body.paragraphs.items[0]`). It is what errors are allowed to say. The handle never
// appears in an error, because a handle is the engine's name for the object, not the
// consumer's.

import type { AutomationHandle } from '@docx-editor.dev/core-contract/automation';
import { fail } from './errors.ts';

export type ObjectPathState =
  /** Promised: created by a queued read that has not answered yet. */
  | { readonly status: 'pending' }
  /** Addressable: the host has named this object. */
  | { readonly status: 'resolved'; readonly handle: AutomationHandle }
  /** A `getItemOrNullObject` that found nothing. Not an error, and never addressable. */
  | { readonly status: 'null' }
  /** Its run ended without tracking it. Terminal. */
  | { readonly status: 'released' };

export class ObjectPath {
  readonly label: string;
  #state: ObjectPathState;

  private constructor(label: string, state: ObjectPathState) {
    this.label = label;
    this.#state = state;
  }

  /** A path that is addressable from the moment it exists — a root, or an item just hydrated. */
  static of(label: string, handle: AutomationHandle): ObjectPath {
    return new ObjectPath(label, { status: 'resolved', handle });
  }

  /** A path a queued read will fill in — or mark null. */
  static pending(label: string): ObjectPath {
    return new ObjectPath(label, { status: 'pending' });
  }

  get state(): ObjectPathState {
    return this.#state;
  }

  get isAddressable(): boolean {
    return this.#state.status === 'resolved';
  }

  get isPending(): boolean {
    return this.#state.status === 'pending';
  }

  get isNull(): boolean {
    return this.#state.status === 'null';
  }

  get isReleased(): boolean {
    return this.#state.status === 'released';
  }

  /**
   * The handle to put in a batch, or a refusal.
   *
   * Both refusals are `InvalidObjectPath` on purpose: from a consumer's side "this object was
   * released" and "this object is still a promise" are the same mistake — using an object the
   * runtime cannot address yet or any more — and the `target` says which object it was.
   */
  handle(): AutomationHandle {
    const state = this.#state;
    if (state.status === 'resolved') return state.handle;
    fail({ code: 'InvalidObjectPath', target: this.label });
  }

  /**
   * Hydration: the read answered, and this is the object it named.
   *
   * A released path stays released. Hydration arriving for one is not an error — a batch can be
   * in flight when a run ends — but resurrecting the object would hand back a proxy whose
   * lifetime rules had already been applied.
   */
  resolveTo(handle: AutomationHandle): void {
    if (this.#state.status === 'released') return;
    this.#state = { status: 'resolved', handle };
  }

  /** Hydration: the read answered, and there was nothing there. */
  resolveNull(): void {
    if (this.#state.status === 'released') return;
    this.#state = { status: 'null' };
  }

  /** The run ended and nothing kept this object alive. Terminal. */
  release(): void {
    this.#state = { status: 'released' };
  }
}

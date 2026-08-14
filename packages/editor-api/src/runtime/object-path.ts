/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
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

import type { AutomationHandle, AutomationSpan } from '@docx-editor.dev/core/automation';
import { fail } from './errors.ts';

/**
 * What the host is told to look at.
 *
 * Two shapes, because the protocol names two kinds of thing. Most objects ARE something the host
 * minted a handle for. A stretch of a story is not: it is two endpoints, each a paragraph handle
 * and a UTF-16 offset, and there is no third object behind it to hand out a handle for. Giving a
 * range a handle of its own would mean the host tracking a region across every edit, which is a
 * promise it cannot keep — so the address is the endpoints, and a deleted paragraph makes the
 * whole address refuse rather than silently name a different place.
 */
export type ObjectAddress =
  | { readonly kind: 'handle'; readonly handle: AutomationHandle }
  | { readonly kind: 'span'; readonly span: AutomationSpan };

export type ObjectPathState =
  /** Promised: created by a queued read that has not answered yet. */
  | { readonly status: 'pending' }
  /** Addressable: the host has named this object, or the span it stands for is known. */
  | { readonly status: 'resolved'; readonly address: ObjectAddress }
  /** A `get…OrNullObject` that found nothing. Not an error, and never addressable. */
  | { readonly status: 'null' }
  /** Its run ended without tracking it. Terminal. */
  | { readonly status: 'released' };

export class ObjectPath {
  readonly label: string;
  #state: ObjectPathState;
  /**
   * The path whose fate this one shares.
   *
   * A collection is not addressed independently of the thing it belongs to: `range.paragraphs` is
   * addressable exactly when the range is, and released when the range is. Delegating rather than
   * copying is what makes that true at the moment it matters — a collection built from a range
   * that the same batch is still resolving must not have captured "pending" forever.
   */
  readonly #parent: ObjectPath | null;

  private constructor(label: string, state: ObjectPathState, parent: ObjectPath | null = null) {
    this.label = label;
    this.#state = state;
    this.#parent = parent;
  }

  /** A path that is addressable from the moment it exists — a root, or an item just hydrated. */
  static of(label: string, handle: AutomationHandle): ObjectPath {
    return new ObjectPath(label, { status: 'resolved', address: { kind: 'handle', handle } });
  }

  /** The same, for an object that IS a stretch of a story. */
  static ofSpan(label: string, span: AutomationSpan): ObjectPath {
    return new ObjectPath(label, { status: 'resolved', address: { kind: 'span', span } });
  }

  /** A path a queued read will fill in — or mark null. */
  static pending(label: string): ObjectPath {
    return new ObjectPath(label, { status: 'pending' });
  }

  /** A path that is whatever its owner's path is, under its own name. */
  static derived(label: string, parent: ObjectPath): ObjectPath {
    return new ObjectPath(label, { status: 'pending' }, parent);
  }

  get state(): ObjectPathState {
    return this.#parent ? this.#parent.state : this.#state;
  }

  get isAddressable(): boolean {
    return this.state.status === 'resolved';
  }

  get isPending(): boolean {
    return this.state.status === 'pending';
  }

  get isNull(): boolean {
    return this.state.status === 'null';
  }

  get isReleased(): boolean {
    return this.state.status === 'released';
  }

  /**
   * What to put in a batch, or a refusal.
   *
   * Both refusals are `InvalidObjectPath` on purpose: from a consumer's side "this object was
   * released" and "this object is still a promise" are the same mistake — using an object the
   * runtime cannot address yet or any more — and the `target` says which object it was.
   *
   * THE CODE IS ONE THING AND THE MESSAGE IS ANOTHER. The two states have different fixes — a
   * promise needs a `sync()`, a released object needs to have been tracked — so the sentence in
   * `errors.ts` names both. It described only the released half for a while, which sent a
   * consumer holding a perfectly good promised object off to `trackedObjects.add(...)`.
   */
  address(): ObjectAddress {
    const state = this.state;
    if (state.status === 'resolved') return state.address;
    fail({ code: 'InvalidObjectPath', target: this.label });
  }

  /** The handle to address this object with. Refused for anything that is not handle-shaped. */
  handle(): AutomationHandle {
    const address = this.address();
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: this.label });
    return address.handle;
  }

  /** The span this object stands for. Refused for anything that is not span-shaped. */
  span(): AutomationSpan {
    const address = this.address();
    if (address.kind !== 'span') fail({ code: 'InvalidObjectPath', target: this.label });
    return address.span;
  }

  /**
   * Hydration: the read answered, and this is the object it named.
   *
   * A released path stays released. Hydration arriving for one is not an error — a batch can be
   * in flight when a run ends — but resurrecting the object would hand back a proxy whose
   * lifetime rules had already been applied.
   */
  resolveTo(handle: AutomationHandle): void {
    this.#resolve({ kind: 'handle', handle });
  }

  /** The same, for an object that came back as a stretch of a story. */
  resolveToSpan(span: AutomationSpan): void {
    this.#resolve({ kind: 'span', span });
  }

  /** Hydration: the read answered, and there was nothing there. */
  resolveNull(): void {
    if (this.#state.status === 'released') return;
    this.#state = { status: 'null' };
  }

  /**
   * The run ended and nothing kept this object alive. Terminal.
   *
   * A derived path does not release: its owner's release is what governs it, and releasing here
   * would let a collection's lifetime end its parent's.
   */
  release(): void {
    if (this.#parent) return;
    this.#state = { status: 'released' };
  }

  #resolve(address: ObjectAddress): void {
    if (this.#state.status === 'released') return;
    this.#state = { status: 'resolved', address };
  }
}

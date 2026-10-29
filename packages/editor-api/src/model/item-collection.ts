/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What every collection in this model does the same way.
//
// A COLLECTION IS NOT AN OBJECT THE HOST NAMES. It is a question about something that is: "the
// paragraphs of this story", "the lists in it", "the replies to this comment". So a collection
// addresses itself through its OWNER's path — derived, not copied, so that a collection built from a
// range the current batch is still resolving becomes addressable exactly when the range does — and
// each subclass supplies the one read that answers its question.
//
// `items` IS THE LOADED ANSWER, never a live view. A collection loaded in one batch describes the
// document as of that batch; members added afterwards are not in it, and reaching them means loading
// again. The alternative — re-reading on every property access — would make reading a property send
// a batch, which is the one thing this runtime does not do.
//
// AN ITEM ACCESSOR IS ALSO A READ. `getFirst()` answers a proxy immediately and finds out during the
// sync whether it was there; an empty collection then fails `ItemNotFound`, reported against the
// consumer's own `getFirst()` call. The `…OrNullObject` form answers the same kind of proxy and lets
// it say `isNullObject` instead, which is what code that expects nothing wants.
//
// ITS OWN MODULE, and importing no other model class: seven collections extend the base here, and
// each of them imports the item type it builds. A base class living beside one of those subclasses
// makes the whole model's evaluation order depend on which file an entry happens to import first —
// which is exactly the cycle that had `ListCollection` extending an uninitialised class.

import {
  ClientObject,
  ObjectPath,
  fail,
  hydratedHandles,
  type AutomationOperation,
  type AutomationValue,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';

/**
 * The item properties a collection's `load(...)` names.
 *
 * A collection has one property of its own, `items`. Any other name is a property of each item,
 * the same as its `items/` path, so `collection.load('text')` reads like `load('items/text')`.
 */
export function collectionItemSelection(request: ResolvedLoadOptions): readonly string[] {
  return [
    ...new Set([...request.select.filter((name) => name !== 'items'), ...request.itemSelect]),
  ];
}

/**
 * The loads one collection has queued in the current sync.
 *
 * REPEATED LOADS ACCUMULATE. `load('items/text'); load('items/style'); sync()` must leave both
 * readable. There is one read per window (`skip`, `top`) per sync: a later load with the same
 * window joins the queued read instead of queueing another, and every load's item properties go
 * into one set that every window's read uses. So whichever read settles last and sets `items`, its
 * members carry every property this sync asked for. Whether a read queues item reads is asked when
 * the sync takes it, so a bare `load('items')` that a later `load('items/text')` joins becomes one
 * that does. A load stops accepting joins once a sync takes it.
 */
export class CollectionLoads {
  #names: Set<string> | undefined;
  readonly #windows = new Set<string>();

  /** Add a load's item properties. True when a read for its window is already queued. */
  join(names: readonly string[], skip: number, top: number | undefined): boolean {
    this.#names ??= new Set();
    for (const name of names) this.#names.add(name);
    return this.#windows.has(windowKey(skip, top));
  }

  /**
   * Queue the read for a window. `enqueue` receives the shared names and the `release` that ends
   * the window's joining; a window whose read could not be queued is released at once.
   */
  open(
    skip: number,
    top: number | undefined,
    enqueue: (names: ReadonlySet<string>, release: () => void) => void
  ): void {
    const names = (this.#names ??= new Set());
    const key = windowKey(skip, top);
    this.#windows.add(key);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      this.#windows.delete(key);
      // The next sync's loads start a set of their own.
      if (this.#windows.size === 0) this.#names = undefined;
    };
    try {
      enqueue(names, release);
    } catch (error) {
      release();
      throw error;
    }
  }
}

function windowKey(skip: number, top: number | undefined): string {
  return `${String(skip)}:${top === undefined ? '' : String(top)}`;
}

/** The index after the last member a `skip`/`top` window covers in a listing of `total`. */
export function windowEnd(total: number, skip: number, top: number | undefined): number {
  return top === undefined ? total : Math.min(total, skip + top);
}

/** What a promised member is told once the read that looked for it has answered. */
export interface PromisedItem {
  /** @internal The member was there, at this address. */
  hydrateAddress(address: ObjectAddress): void;
  /** @internal There was no such member. */
  hydrateNull(): void;
}

/** An edge accessor waiting for the answer that will say what it names. */
interface PendingEdge {
  readonly edge: 'first' | 'last';
  readonly target: string;
  readonly nullable: boolean;
  readonly item: PromisedItem;
}

export abstract class ItemCollection<T extends ClientObject> extends ClientObject {
  /**
   * The answer a command already gave, once it has given it.
   *
   * Kept so an edge asked for AFTER the sync is answered from the same members `items` holds,
   * rather than being told there is no read for it.
   */
  #answer: { readonly value: AutomationValue; readonly label: string } | undefined;
  /** Edges asked for BEFORE that answer arrived. */
  readonly #pending: PendingEdge[] = [];
  /** Loads queued in the current sync, which a repeated load joins. */
  readonly #loads = new CollectionLoads();

  protected constructor(context: RequestContext, path: ObjectPath) {
    super(context, path);
  }

  /**
   * The read that lists this collection's members, or `null` when a write already answered them.
   *
   * `Paragraph#split` is the case that needs the second shape: the operation that breaks the
   * paragraph is the same operation that says what the pieces are, so the collection it answers is
   * filled by that command's own result. Listing it again afterwards would describe a DIFFERENT
   * document — the one the split produced — and quietly turn one atomic call into two.
   */
  protected abstract listing(): AutomationOperation | null;

  /** How many members an answer holds, without building any of them. */
  protected abstract size(value: AutomationValue, label: string): number;

  /** Where the member at `index` is, or `undefined` if the answer has no such member. */
  protected abstract addressAt(
    value: AutomationValue,
    label: string,
    index: number
  ): ObjectAddress | undefined;

  /** A member of this collection, already addressed. */
  protected abstract itemAt(label: string, address: ObjectAddress): T;

  /** A member with no verdict yet — what both item accessors answer with. */
  protected abstract promised(label: string, nullable: boolean): T & PromisedItem;

  /**
   * The members this collection was loaded with.
   *
   * `PropertyNotLoaded` until a `load(...)` has been synced: a collection that answered `[]`
   * before it had been read would be indistinguishable from an empty document. Name an item
   * property with an `items/` path, such as `load('items/text')`, to load it on every member in
   * the same sync.
   */
  get items(): readonly T[] {
    return this.loadedProperty<readonly T[]>('items');
  }

  /** @internal Take the members straight from the command that produced them. */
  fill(value: AutomationValue, label: string): void {
    this.setLoadedProperty('items', this.#members(value, label, 0, undefined));
    this.#answer = { value, label };
    // The edges a caller asked for before this arrived. Settled in the order they were asked for,
    // and a refusal here is the answer to THAT call — `getFirst()` on a collection that turned out
    // to hold nothing is `ItemNotFound`, reported against the accessor the consumer wrote.
    const waiting = this.#pending.splice(0, this.#pending.length);
    for (const edge of waiting) this.#settleEdge(edge, value);
  }

  /** @internal Collections accept `items/<property>` paths. */
  protected override get loadsItemPaths(): boolean {
    return true;
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected onLoad(request: ResolvedLoadOptions): void {
    const itemSelect = collectionItemSelection(request);
    if (itemSelect.length > 0) this.#checkItemSelect(itemSelect);
    const listing = this.path.isPending ? undefined : this.listing();
    const label = `${this.path.label}.items`;
    // Already answered by the command that made this collection: there is nothing to ask for, and
    // asking anyway would send a second operation the consumer did not write.
    const skip = request.skip ?? 0;
    const top = request.top;
    const windowed = request.skip !== undefined || top !== undefined;
    if (listing === null) {
      if (itemSelect.length === 0 && !windowed) return;
      // The members are known once the command has answered. A window and item properties then
      // apply to that answer, and the item loads are ordinary reads in queue order. Before that,
      // the reads would have to run inside the command's own sync, after any later write in it,
      // so they are refused rather than answered from a different document state.
      const answer = this.#answer;
      if (!answer) fail({ code: 'NotImplemented', target: label });
      const members = this.#members(answer.value, answer.label, skip, top);
      this.setLoadedProperty('items', members);
      if (itemSelect.length > 0) for (const item of members) item.load(itemSelect);
      return;
    }
    // A later load in the same sync with this window joins this read: one listing, every name.
    if (this.#loads.join(itemSelect, skip, top)) return;
    this.#loads.open(skip, top, (shared, release) =>
      this.enqueue({
        sort: 'read',
        label,
        // Asked when the sync takes the read, after every load of this sync has joined.
        continues: () => shared.size > 0,
        capture: release,
        dispose: release,
        plan: () => {
          const resolved = listing ?? this.listing();
          if (!resolved) fail({ code: 'InvalidObjectPath', target: this.path.label });
          return resolved;
        },
        settle: (value) => {
          const members = this.#members(value, label, skip, top);
          this.setLoadedProperty('items', members);
          const names = [...shared];
          if (names.length === 0) return;
          this.internals.queue.continuing(() => {
            for (const item of members) item.load(names);
          });
        },
      })
    );
  }

  /**
   * Refuse an item property this collection's members do not have, at the `load` call.
   *
   * A member that does not exist yet answers the question: it runs the same selection a real
   * member runs, and what it queues is discarded. Checking here, not when the listing answers,
   * reports the refusal at the call the consumer wrote, before anything is sent.
   */
  #checkItemSelect(itemSelect: readonly string[]): void {
    const probe = this.promised(`${this.path.label}.items`, false);
    const queued = this.internals.queue.collect(() => {
      try {
        probe.load(itemSelect);
      } catch (error) {
        // Only a refused name is this check's answer. A member that is not addressed yet can
        // refuse for that reason alone, and a real member will not.
        if ((error as { code?: unknown }).code === 'InvalidArgument') throw error;
      }
    });
    for (const action of queued) action.dispose?.();
  }

  /** One member, by which end of the collection it is at. */
  protected edge(edge: 'first' | 'last', accessor: string, nullable: boolean): T {
    const target = `${this.path.label}.${accessor}()`;
    const item = this.promised(target, nullable);
    const listing = this.path.isPending ? undefined : this.listing();
    // NO LISTING MEANS THE MEMBERS ARE AN ANSWER, NOT A QUESTION — the ranges a split produced.
    // The edge is taken from that same answer: sending a listing instead would read the document
    // the split had already made, where the split's first piece need not be the first paragraph,
    // and it would turn one atomic call into two.
    if (listing === null) {
      const pending: PendingEdge = { edge, target, nullable, item };
      if (this.#answer) this.#settleEdge(pending, this.#answer.value);
      else this.#pending.push(pending);
      return item;
    }
    this.enqueue({
      sort: 'read',
      label: target,
      plan: () => {
        const resolved = listing ?? this.listing();
        if (!resolved) fail({ code: 'InvalidObjectPath', target: this.path.label });
        return resolved;
      },
      settle: (value) => {
        this.#settleEdge({ edge, target, nullable, item }, value);
      },
    });
    return item;
  }

  #settleEdge(pending: PendingEdge, value: AutomationValue): void {
    const { edge, target, nullable, item } = pending;
    const total = this.size(value, target);
    if (total === 0) {
      if (!nullable) fail({ code: 'ItemNotFound', target });
      item.hydrateNull();
      return;
    }
    const address = this.addressAt(value, target, edge === 'first' ? 0 : total - 1);
    if (!address) fail({ code: 'ItemNotFound', target });
    item.hydrateAddress(address);
  }

  #members(
    value: AutomationValue,
    label: string,
    skip: number,
    top: number | undefined
  ): readonly T[] {
    const total = this.size(value, label);
    const last = windowEnd(total, skip, top);
    const items: T[] = [];
    for (let index = skip; index < last; index += 1) {
      const address = this.addressAt(value, label, index);
      if (address) items.push(this.itemAt(`${label}[${String(index)}]`, address));
    }
    return items;
  }
}

/**
 * The shape almost every collection here has: a listing that answers HANDLES.
 *
 * Only the paragraph and range collections need anything else — ranges are spans, and a split
 * answers its own members — so the size-and-address half is written once rather than in each of the
 * seven collections that would otherwise copy it and be able to copy it wrongly.
 */
export abstract class HandleCollection<
  T extends ClientObject & PromisedItem,
> extends ItemCollection<T> {
  /** @internal How many members the listing's answer describes. */
  protected size(value: AutomationValue, label: string): number {
    return hydratedHandles(value, label).length;
  }

  /** @internal The address of one member of the listing's answer. */
  protected addressAt(
    value: AutomationValue,
    label: string,
    index: number
  ): ObjectAddress | undefined {
    const handle = hydratedHandles(value, label)[index];
    return handle ? { kind: 'handle', handle } : undefined;
  }
}

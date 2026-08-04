// The two collections this slice publishes, and the rules they share.
//
// A COLLECTION IS NOT AN OBJECT THE HOST NAMES. It is a question about something that is: "the
// paragraphs of this story", "the paragraphs this range covers", "where this text occurs". So a
// collection addresses itself through its OWNER's path — derived, not copied, so that a collection
// built from a range the current batch is still resolving becomes addressable exactly when the
// range does — and each subclass supplies the one read that answers its question.
//
// `items` IS THE LOADED ANSWER, never a live view. A collection loaded in one batch describes the
// document as of that batch; paragraphs inserted afterwards are not in it, and reaching them means
// loading again. The alternative — re-reading on every property access — would make reading a
// property send a batch, which is the one thing this runtime does not do.
//
// AN ITEM ACCESSOR IS ALSO A READ. `getFirst()` answers a proxy immediately and finds out during
// the sync whether it was there; an empty collection then fails `ItemNotFound`, reported against
// the consumer's own `getFirst()` call. The `…OrNullObject` form answers the same kind of proxy and
// lets it say `isNullObject` instead, which is what code that expects nothing wants.

import {
  ClientObject,
  ObjectPath,
  fail,
  hydratedHandles,
  hydratedSpans,
  selectedProperties,
  type AutomationOperation,
  type AutomationValue,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { Paragraph } from './paragraph.ts';
import { Range } from './range.ts';

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

abstract class ItemCollection<T extends ClientObject> extends ClientObject {
  /**
   * The answer a command already gave, once it has given it.
   *
   * Kept so an edge asked for AFTER the sync is answered from the same members `items` holds,
   * rather than being told there is no read for it.
   */
  #answer: { readonly value: AutomationValue; readonly label: string } | undefined;
  /** Edges asked for BEFORE that answer arrived. */
  readonly #pending: PendingEdge[] = [];

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
   * before it had been read would be indistinguishable from an empty document.
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

  protected onLoad(request: ResolvedLoadOptions): void {
    selectedProperties(request, ['items'], this.path.label);
    const listing = this.listing();
    // Already answered by the command that made this collection: there is nothing to ask for, and
    // asking anyway would send a second operation the consumer did not write.
    if (!listing) return;
    const label = `${this.path.label}.items`;
    const skip = request.skip ?? 0;
    const top = request.top;
    this.enqueue({
      sort: 'read',
      label,
      plan: () => listing,
      settle: (value) => {
        this.setLoadedProperty('items', this.#members(value, label, skip, top));
      },
    });
  }

  /** One member, by which end of the collection it is at. */
  protected edge(edge: 'first' | 'last', accessor: string, nullable: boolean): T {
    const target = `${this.path.label}.${accessor}()`;
    const item = this.promised(target, nullable);
    const listing = this.listing();
    // NO LISTING MEANS THE MEMBERS ARE AN ANSWER, NOT A QUESTION — the ranges a split produced.
    // The edge is taken from that same answer: sending a listing instead would read the document
    // the split had already made, where the split's first piece need not be the first paragraph,
    // and it would turn one atomic call into two.
    if (!listing) {
      const pending: PendingEdge = { edge, target, nullable, item };
      if (this.#answer) this.#settleEdge(pending, this.#answer.value);
      else this.#pending.push(pending);
      return item;
    }
    this.enqueue({
      sort: 'read',
      label: target,
      plan: () => listing,
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
    const last = top === undefined ? total : Math.min(total, skip + top);
    const items: T[] = [];
    for (let index = skip; index < last; index += 1) {
      const address = this.addressAt(value, label, index);
      if (address) items.push(this.itemAt(`${label}[${String(index)}]`, address));
    }
    return items;
  }
}

export class ParagraphCollection extends ItemCollection<Paragraph> {
  /** @internal A story's paragraphs, or a range's, depending on the path it derives from. */
  static of(context: RequestContext, label: string, owner: ObjectPath): ParagraphCollection {
    return new ParagraphCollection(context, ObjectPath.derived(label, owner));
  }

  /** The first paragraph. `ItemNotFound` at the sync if the collection holds none. */
  getFirst(): Paragraph {
    return this.edge('first', 'getFirst', false);
  }

  /** The last paragraph. `ItemNotFound` at the sync if the collection holds none. */
  getLast(): Paragraph {
    return this.edge('last', 'getLast', false);
  }

  /** The first paragraph, or an object that will report `isNullObject`. */
  getFirstOrNullObject(): Paragraph {
    return this.edge('first', 'getFirstOrNullObject', true);
  }

  /** The last paragraph, or an object that will report `isNullObject`. */
  getLastOrNullObject(): Paragraph {
    return this.edge('last', 'getLastOrNullObject', true);
  }

  protected listing(): AutomationOperation {
    const address = this.path.address();
    return address.kind === 'handle'
      ? { op: 'getParagraphs', body: address.handle }
      : { op: 'getSpanParagraphs', span: address.span };
  }

  protected size(value: AutomationValue, label: string): number {
    return hydratedHandles(value, label).length;
  }

  protected addressAt(
    value: AutomationValue,
    label: string,
    index: number
  ): ObjectAddress | undefined {
    const handle = hydratedHandles(value, label)[index];
    return handle ? { kind: 'handle', handle } : undefined;
  }

  protected itemAt(label: string, address: ObjectAddress): Paragraph {
    return Paragraph.at(this.context, label, address);
  }

  protected promised(label: string, nullable: boolean): Paragraph & PromisedItem {
    return Paragraph.promised(this.context, label, nullable);
  }
}

export class RangeCollection extends ItemCollection<Range> {
  readonly #plan: (() => AutomationOperation) | null;

  /** @internal Ranges a read answers: where some text occurs. */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    plan: () => AutomationOperation
  ): RangeCollection {
    return new RangeCollection(context, ObjectPath.derived(label, owner), plan);
  }

  /** @internal Ranges a command answers: the pieces a split produced. Filled by that command. */
  static answered(context: RequestContext, label: string, owner: ObjectPath): RangeCollection {
    return new RangeCollection(context, ObjectPath.derived(label, owner), null);
  }

  private constructor(
    context: RequestContext,
    path: ObjectPath,
    plan: (() => AutomationOperation) | null
  ) {
    super(context, path);
    this.#plan = plan;
  }

  /** The first range. `ItemNotFound` at the sync if nothing matched. */
  getFirst(): Range {
    return this.edge('first', 'getFirst', false);
  }

  /**
   * The last range. `ItemNotFound` at the sync if nothing matched.
   *
   * A DocxEditor member rather than a compatibility one: the reference's range collection publishes
   * only its first, and the pieces of a split are the case that makes the other end worth having —
   * "the paragraph this one ended up as" is the last piece, and counting `items` to find it means
   * loading them all. Recorded as an omission in `compat/manifest.json` for that reason.
   */
  getLast(): Range {
    return this.edge('last', 'getLast', false);
  }

  /** The first range, or an object that will report `isNullObject`. */
  getFirstOrNullObject(): Range {
    return this.edge('first', 'getFirstOrNullObject', true);
  }

  protected listing(): AutomationOperation | null {
    return this.#plan ? this.#plan() : null;
  }

  protected size(value: AutomationValue, label: string): number {
    return hydratedSpans(value, label).length;
  }

  protected addressAt(
    value: AutomationValue,
    label: string,
    index: number
  ): ObjectAddress | undefined {
    const span = hydratedSpans(value, label)[index];
    return span ? { kind: 'span', span } : undefined;
  }

  protected itemAt(label: string, address: ObjectAddress): Range {
    return Range.at(this.context, label, address);
  }

  protected promised(label: string, nullable: boolean): Range & PromisedItem {
    return Range.promised(this.context, label, nullable);
  }
}

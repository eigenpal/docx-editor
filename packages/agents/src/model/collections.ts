// The paragraph and range collections: the two whose members are not simply handles.
//
// The rules every collection shares — how it addresses itself, what `items` means, how an edge
// accessor settles — live in `item-collection.ts`, which nothing in the model imports FROM. These
// two are here because they are the exceptions to the common shape: a range collection's members are
// spans rather than handles, and the pieces a `Paragraph#split` answers are filled by the split's own
// command rather than by a listing read.

import {
  ObjectPath,
  hydratedHandles,
  hydratedSpans,
  type AutomationOperation,
  type AutomationValue,
  type ObjectAddress,
  type RequestContext,
} from '../runtime/model-support.ts';
import { HandleCollection, ItemCollection, type PromisedItem } from './item-collection.ts';
import { Paragraph } from './paragraph.ts';
import { Range } from './range.ts';

export { HandleCollection, ItemCollection, type PromisedItem } from './item-collection.ts';

export class ParagraphCollection extends ItemCollection<Paragraph> {
  readonly #plan: (() => AutomationOperation) | null;

  /** @internal A story's paragraphs, or a range's, depending on the path it derives from. */
  static of(context: RequestContext, label: string, owner: ObjectPath): ParagraphCollection {
    return new ParagraphCollection(context, ObjectPath.derived(label, owner), null);
  }

  /**
   * @internal Paragraphs a named read answers: a list's items, or one level of them.
   *
   * The owner's own address does not say which paragraphs are wanted — a list is not a place in the
   * story, it is a set of them — so the operation is supplied instead of derived.
   */
  static overListing(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    plan: () => AutomationOperation
  ): ParagraphCollection {
    return new ParagraphCollection(context, ObjectPath.derived(label, owner), plan);
  }

  private constructor(
    context: RequestContext,
    path: ObjectPath,
    plan: (() => AutomationOperation) | null
  ) {
    super(context, path);
    this.#plan = plan;
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
    if (this.#plan) return this.#plan();
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

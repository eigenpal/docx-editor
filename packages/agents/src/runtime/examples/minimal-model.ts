// A deliberately minimal object model over the proxy runtime.
//
// The published object model — `Document`, `Body`, `Range`, `Paragraph`, their collections and
// search — is a later slice. This is the smallest model that exercises every runtime primitive
// once: a root object, a property whose value only exists after a sync, a collection that
// hydrates into proxies, an "or null object" lookup, a method that answers a `ClientResult`, and
// a write that must be queued rather than performed.
//
// It lives in the package, next to the examples that use it, rather than only in a test. The
// examples are compiled and executed, so they are honest documentation of how a batch reads; and
// a model written against ONLY the protected surface of `ClientObject` proves that surface is
// sufficient — if the real model needed privileged access the runtime does not offer, this file
// would have needed it first. It is not exported from the package entry, and it is not the shape
// of the real model.
//
// ONE PLACE IT DIVERGES FROM WHAT AN OFFICE-SHAPED SAMPLE EXPECTS, and it is a property of the
// host protocol rather than of this model: an operation names its target with a handle, and a
// handle is DATA in the batch request, so an object has to appear in some answer before anything
// can be asked of it. A collection therefore loads its `items`, and the items load their own
// properties — two batches, explicitly, in the consumer's own code. Selecting an item's property
// on the collection is refused by name rather than quietly turned into a second batch inside one
// `sync()`: that would trade the guarantee this runtime exists to make (one sync is one atomic
// batch) for syntax, and it would do it invisibly.

import { fail } from '../errors.ts';
import {
  ClientObject,
  ObjectPath,
  clientResult,
  hydratedApplied,
  hydratedHandles,
  hydratedText,
  internalsOf,
  selectedProperties,
  type AutomationHandle,
  type ClientResult,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../model-support.ts';

/** The document: the root the rest is reached from. */
export class MiniDocument extends ClientObject {
  #body: MiniBody | undefined;

  static open(context: RequestContext): MiniDocument {
    return new MiniDocument(context);
  }

  private constructor(context: RequestContext) {
    super(context, ObjectPath.of('document', internalsOf(context).roots().document));
  }

  /**
   * The main story.
   *
   * The same proxy every time, like every navigation property in this API: a consumer who loads
   * `document.body` and then reads `document.body.text` is talking about one object, and handing
   * back a fresh proxy per access would make the load land on one and the read on another.
   */
  get body(): MiniBody {
    this.#body ??= new MiniBody(this.context);
    return this.#body;
  }

  protected onLoad(request: ResolvedLoadOptions): void {
    // The document itself offers no readable property in this slice, so the only selection it
    // accepts is the empty one — and naming a property it does not have is refused rather than
    // ignored.
    selectedProperties(request, [], 'document');
  }
}

/** The main story: its text, its paragraphs, and one method that answers a result. */
export class MiniBody extends ClientObject {
  #paragraphs: MiniParagraphCollection | undefined;

  /** @internal */
  constructor(context: RequestContext) {
    super(context, ObjectPath.of('document.body', internalsOf(context).roots().body));
  }

  get paragraphs(): MiniParagraphCollection {
    this.#paragraphs ??= new MiniParagraphCollection(this.context, this.handle());
    return this.#paragraphs;
  }

  /** The body's text. Readable after a `load('text')` and a `sync()`. */
  get text(): string {
    return this.loadedProperty<string>('text');
  }

  /** The same read, for code that wants a value rather than a property. */
  getText(): ClientResult<string> {
    const target = 'document.body.getText';
    const { result, fill } = clientResult<string>(target);
    const handle = this.handle();
    this.enqueue({
      sort: 'read',
      label: target,
      plan: () => ({ op: 'getText', target: handle }),
      settle: (value) => fill(hydratedText(value, target)),
    });
    return result;
  }

  protected onLoad(request: ResolvedLoadOptions): void {
    if (!selectedProperties(request, ['text'], 'document.body').includes('text')) return;
    const label = 'document.body.text';
    const handle = this.handle();
    this.enqueue({
      sort: 'read',
      label,
      plan: () => ({ op: 'getText', target: handle }),
      settle: (value) => {
        this.setLoadedProperty('text', hydratedText(value, label));
      },
    });
  }
}

/**
 * The body's paragraphs.
 *
 * A collection is not a document object the host names, so it addresses itself with its parent's
 * handle and the read that lists that parent's paragraphs. That is a property of this protocol
 * slice rather than a rule of the runtime — an object whose handle came from anywhere else works
 * the same way.
 */
export class MiniParagraphCollection extends ClientObject {
  /** @internal */
  constructor(context: RequestContext, body: AutomationHandle) {
    super(context, ObjectPath.of('document.body.paragraphs', body));
  }

  /** The loaded items. `PropertyNotLoaded` until a `load(...)` has been synced. */
  get items(): readonly MiniParagraph[] {
    return this.loadedProperty<readonly MiniParagraph[]>('items');
  }

  /**
   * The item at an index, or an object that will say it is null.
   *
   * The proxy comes back immediately with no verdict: `isNullObject` is `PropertyNotLoaded` until
   * the sync that looked, and only then true or false. Answering `null` here instead would force
   * a consumer to sync before they could carry on building the batch, which is the whole reason
   * the "or null object" shape exists.
   */
  getItemOrNullObject(index: number): MiniParagraph {
    const target = 'document.body.paragraphs.getItemOrNullObject';
    if (!Number.isInteger(index) || index < 0) fail({ code: 'InvalidArgument', target });
    const label = `document.body.paragraphs.items[${String(index)}]`;
    const item = MiniParagraph.pending(this.context, label);
    const handle = this.handle();
    this.enqueue({
      sort: 'read',
      label,
      plan: () => ({ op: 'getParagraphs', body: handle }),
      settle: (value) => {
        const found = hydratedHandles(value, label)[index];
        if (found) item.hydrate(found);
        else item.hydrateNull();
      },
    });
    return item;
  }

  protected onLoad(request: ResolvedLoadOptions): void {
    selectedProperties(request, ['items'], 'document.body.paragraphs');
    const label = 'document.body.paragraphs.items';
    const handle = this.handle();
    const skip = request.skip ?? 0;
    const top = request.top;
    this.enqueue({
      sort: 'read',
      label,
      plan: () => ({ op: 'getParagraphs', body: handle }),
      settle: (value) => {
        const listed = hydratedHandles(value, label);
        const page = top === undefined ? listed.slice(skip) : listed.slice(skip, skip + top);
        const items = page.map((paragraph, at) =>
          MiniParagraph.at(
            this.context,
            `document.body.paragraphs.items[${String(skip + at)}]`,
            paragraph
          )
        );
        this.setLoadedProperty('items', items);
      },
    });
  }
}

/** One paragraph: its text, and a write into it. */
export class MiniParagraph extends ClientObject {
  /** @internal */
  static at(context: RequestContext, label: string, handle: AutomationHandle): MiniParagraph {
    return new MiniParagraph(context, ObjectPath.of(label, handle));
  }

  /** @internal */
  static pending(context: RequestContext, label: string): MiniParagraph {
    return new MiniParagraph(context, ObjectPath.pending(label));
  }

  private constructor(context: RequestContext, path: ObjectPath) {
    super(context, path, { nullable: path.isPending });
  }

  /** @internal Hydration from the read that found it. */
  hydrate(handle: AutomationHandle): void {
    this.path.resolveTo(handle);
  }

  /** @internal Hydration from the read that did not. */
  hydrateNull(): void {
    this.path.resolveNull();
  }

  get text(): string {
    return this.loadedProperty<string>('text');
  }

  /** The same read as `load('text')`, for code that wants a value rather than a property. */
  getText(): ClientResult<string> {
    const target = `${this.path.label}.getText`;
    const { result, fill } = clientResult<string>(target);
    const handle = this.handle();
    this.enqueue({
      sort: 'read',
      label: target,
      plan: () => ({ op: 'getText', target: handle }),
      settle: (value) => fill(hydratedText(value, target)),
    });
    return result;
  }

  /** Queue an insertion at a UTF-16 offset. Nothing is written until `sync()`. */
  insertText(text: string, offset: number): void {
    const label = `${this.path.label}.insertText`;
    if (typeof text !== 'string') fail({ code: 'InvalidArgument', target: label });
    if (!Number.isInteger(offset) || offset < 0) fail({ code: 'InvalidArgument', target: label });
    const handle = this.handle();
    this.enqueue({
      sort: 'write',
      label,
      plan: () => ({ op: 'insertText', paragraph: handle, offset, text }),
      settle: (value) => hydratedApplied(value, label),
    });
  }

  protected onLoad(request: ResolvedLoadOptions): void {
    const label = `${this.path.label}.text`;
    if (!selectedProperties(request, ['text'], this.path.label).includes('text')) return;
    const handle = this.handle();
    this.enqueue({
      sort: 'read',
      label,
      plan: () => ({ op: 'getText', target: handle }),
      settle: (value) => {
        this.setLoadedProperty('text', hydratedText(value, label));
      },
    });
  }
}

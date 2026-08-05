// Bookmarks: the names a document gives to stretches of itself.
//
// A BOOKMARK IS ITS NAME. OOXML writes it as a pair of markers around the text, and the name is the
// only thing that identifies it — so this object is a name plus the range those markers currently
// enclose, and a bookmark whose markers left with the text they surrounded refuses rather than
// answering where they used to be.
//
// `start` AND `end` ARE NOT HERE, and `delete` is not either. The first two are document-wide
// character offsets — the coordinate space already de-selected on `Range` for the same reason: this
// engine addresses positions as a paragraph identity plus a UTF-16 offset, and a whole-document
// counter would go stale under every edit above it. `delete` would have to remove a marker pair,
// which is not an operation the canonical write path offers. Both are recorded as omissions in
// `compat/manifest.json` rather than shipped as members that refuse.

import {
  ObjectPath,
  fail,
  hydratedSpan,
  hydratedText,
  type AutomationHandle,
  type AutomationOperation,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { HandleCollection, type PromisedItem } from './item-collection.ts';
import { selectionMode, type SelectionMode } from './locations.ts';
import { ModelObject } from './model-object.ts';
import { Range } from './range.ts';

export class Bookmark extends ModelObject implements PromisedItem {
  #range: Range | undefined;

  /** @internal A bookmark a read has already named. */
  static at(context: RequestContext, label: string, address: ObjectAddress): Bookmark {
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: label });
    return new Bookmark(context, ObjectPath.of(label, address.handle), false);
  }

  /** @internal A bookmark a queued read will name, or report as nothing. */
  static promised(context: RequestContext, label: string, nullable: boolean): Bookmark {
    return new Bookmark(context, ObjectPath.pending(label), nullable);
  }

  private constructor(context: RequestContext, path: ObjectPath, nullable: boolean) {
    super(context, path, { nullable });
  }

  /** @internal */
  hydrateAddress(address: ObjectAddress): void {
    if (address.kind === 'handle') this.path.resolveTo(address.handle);
    else this.path.resolveNull();
  }

  /** @internal */
  hydrateNull(): void {
    this.path.resolveNull();
  }

  /** The name the document declares this bookmark with. */
  get name(): string {
    return this.loadedProperty<string>('name');
  }

  /**
   * The text the bookmark's markers enclose.
   *
   * Read when it is asked for rather than carried by the bookmark, because the markers move with the
   * text: the range a caller gets is where the bookmark is now, not where it was when the collection
   * was loaded.
   */
  get range(): Range {
    this.#range ??= this.#rangeAt(`${this.path.label}.range`);
    return this.#range;
  }

  /** Put the reader's selection on the bookmark. `NotSupported` where there is no reader. */
  select(selectionMode_?: SelectionMode): void {
    const target = `${this.path.label}.select`;
    const mode = selectionMode(selectionMode_, target);
    this.requireAddressable();
    if (!this.internals.capabilities.selection) fail({ code: 'NotSupported', target });
    const bookmark = this.#handle();
    // TWO operations in one batch and in this order: the range first, then the selection over it.
    // A bookmark is a name, and the caret goes on characters.
    const found = Range.promised(this.context, target, false);
    this.read(
      `${target}.range`,
      () => ({ op: 'getBookmarkRange', bookmark }),
      (value) => {
        found.hydrateAddress({ kind: 'span', span: hydratedSpan(value, target) });
      }
    );
    found.select(mode);
  }

  protected override onLoad(request: ResolvedLoadOptions): void {
    if (!this.selection(request, ['name']).includes('name')) return;
    const label = `${this.path.label}.name`;
    const bookmark = this.#handle();
    this.read(
      label,
      () => ({ op: 'getBookmarkName', bookmark }),
      (value) => {
        this.setLoadedProperty('name', hydratedText(value, label));
      }
    );
  }

  #rangeAt(label: string): Range {
    const bookmark = this.#handle();
    const found = Range.promised(this.context, label, false);
    this.read(
      label,
      () => ({ op: 'getBookmarkRange', bookmark }),
      (value) => {
        found.hydrateAddress({ kind: 'span', span: hydratedSpan(value, label) });
      }
    );
    return found;
  }

  #handle(): AutomationHandle {
    this.requireAddressable();
    return this.path.handle();
  }
}

export class BookmarkCollection extends HandleCollection<Bookmark> {
  readonly #plan: () => AutomationOperation;

  /** @internal The bookmarks a scope holds: a whole story's, or the ones a range overlaps. */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    plan: () => AutomationOperation
  ): BookmarkCollection {
    return new BookmarkCollection(context, ObjectPath.derived(label, owner), plan);
  }

  private constructor(context: RequestContext, path: ObjectPath, plan: () => AutomationOperation) {
    super(context, path);
    this.#plan = plan;
  }

  protected listing(): AutomationOperation {
    return this.#plan();
  }

  protected itemAt(label: string, address: ObjectAddress): Bookmark {
    return Bookmark.at(this.context, label, address);
  }

  protected promised(label: string, nullable: boolean): Bookmark & PromisedItem {
    return Bookmark.promised(this.context, label, nullable);
  }
}

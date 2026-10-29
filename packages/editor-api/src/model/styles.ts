/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The styles a document defines, read so a caller can choose one by name.
//
// A STYLE IS NOT AN OBJECT THE HOST NAMES. The host answers one listing of `styles.xml`, as plain
// data, and every object here reads its values from such a listing. A style is found again by its
// style id, never by its name alone: one name can belong to a character style and a paragraph style
// at once. A lookup by name is the host's: it compares names the way the style setters do.
//
// NOT EVERY LISTED NAME IS A PARAGRAPH STYLE. The listing holds every kind. The paragraph and range
// `style` setters accept paragraph style names only, and refuse character, table, and list names.
//
// READS ONLY. Writing a style definition (its font, its paragraph format, deleting it, adding one)
// is not something this API does, so those members are not published at all. The properties the
// reference declares assignable are readable here and have no setter.

import {
  ObjectPath,
  clientResult,
  type ClientResult,
  fail,
  hydratedNumber,
  hydratedStyles,
  selectedProperties,
  type AutomationStyleRead,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { CollectionLoads, collectionItemSelection, windowEnd } from './item-collection.ts';
import { ModelObject } from './model-object.ts';

/** The kind of a style. @public */
export enum StyleType {
  /** A character style. The paragraph `style` setters refuse its name. */
  character = 'Character',
  /** A numbering style, which defines list formatting. The paragraph `style` setters refuse its name. */
  list = 'List',
  /** A paragraph style, which `paragraph.style` accepts by its `nameLocal`. */
  paragraph = 'Paragraph',
  /**
   * A table style. The paragraph `style` setters refuse its name; `Table.style` accepts its
   * `nameLocal`.
   */
  table = 'Table',
}

/** Every published scalar property: what a bare `load()` reads. */
const PROPERTIES = [
  'nameLocal',
  'type',
  'builtIn',
  'baseStyle',
  'nextParagraphStyle',
  'linked',
  'visibility',
  'priority',
  'quickStyle',
  'unhideWhenUsed',
] as const;
type StyleProperty = (typeof PROPERTIES)[number];

/** The priority a style that states no `w:uiPriority` sorts with. */
const DEFAULT_PRIORITY = 99;

const TYPES: Readonly<Record<AutomationStyleRead['type'], StyleType>> = Object.freeze({
  paragraph: StyleType.paragraph,
  character: StyleType.character,
  table: StyleType.table,
  numbering: StyleType.list,
});

function propertyOf(
  style: AutomationStyleRead,
  property: StyleProperty
): string | boolean | number {
  switch (property) {
    case 'nameLocal':
      return style.name;
    case 'type':
      return TYPES[style.type];
    case 'builtIn':
      return style.builtIn;
    case 'baseStyle':
      return style.basedOn ?? '';
    case 'nextParagraphStyle':
      return style.next ?? '';
    case 'linked':
      return style.linked;
    case 'visibility':
      return !style.hidden;
    case 'priority':
      return style.uiPriority ?? DEFAULT_PRIORITY;
    case 'quickStyle':
      return style.quickStyle;
    case 'unhideWhenUsed':
      return style.unhideWhenUsed;
  }
}

/**
 * One style the document's styles part defines. Every property is read-only and needs a `load`
 * before it is read; `load()` with no arguments reads them all.
 *
 * `nameLocal` is the name the styles part declares. Only a style whose `type` is `Paragraph` can be
 * assigned to `paragraph.style`, `range.style`, or `body.style`; those setters refuse character,
 * table, and list style names. `Table.style` accepts the `nameLocal` of a listed table style.
 *
 * @example Offer the paragraph styles a reader would see
 * ```ts
 * const styles = context.document.getStyles();
 * styles.load('items/nameLocal,items/type,items/visibility,items/unhideWhenUsed,items/priority');
 * await context.sync();
 *
 * // Keep hidden styles that unhide once used, such as heading 2, so they can be applied too.
 * // Many styles share priority 99, so sort by name next for a stable order.
 * const choices = styles.items
 *   .filter((style) => style.type === 'Paragraph' && (style.visibility || style.unhideWhenUsed))
 *   .sort((a, b) => a.priority - b.priority || a.nameLocal.localeCompare(b.nameLocal))
 *   .map((style) => style.nameLocal);
 * ```
 *
 * @public
 */
export class Style extends ModelObject {
  /** The style id this object is found by in a later listing, once known. */
  #id: string | undefined;
  /**
   * Properties loaded on a looked-up style before its lookup answered. The lookup's own answer
   * carries every property, so these are filled from it rather than by a second read.
   */
  #awaiting: Set<string> | undefined;
  /** The properties that were awaiting when the sync took the lookup; its answer fills them. */
  #captured: Set<string> | undefined;

  /** @internal A member of a loaded collection. */
  static listed(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    style: AutomationStyleRead
  ): Style {
    const item = new Style(context, ObjectPath.derived(label, owner), false);
    item.#id = style.id;
    return item;
  }

  /** @internal A style a lookup is still looking for; a sync says whether it exists. */
  static promised(context: RequestContext, label: string): Style {
    const style = new Style(context, ObjectPath.pending(label), true);
    style.#awaiting = new Set();
    return style;
  }

  private constructor(context: RequestContext, path: ObjectPath, nullable: boolean) {
    super(context, path, { nullable });
  }

  /**
   * The name the styles part declares. Assign it to `paragraph.style` only when `type` is
   * `Paragraph`; the paragraph `style` setters refuse other kinds. A built-in name reads as the part
   * writes it, such as `heading 1`, and the setters accept it that way. The setters and
   * `getByNameOrNullObject` compare names without case, so `Heading 1` finds `heading 1`; compare
   * names the same way rather than with `===`.
   */
  get nameLocal(): string {
    return this.loadedProperty<string>('nameLocal');
  }

  /**
   * The kind of style. A numbering style reads as `List`. Only `Paragraph` names are accepted by
   * the paragraph, range, and body `style` setters.
   */
  get type(): StyleType | 'Character' | 'List' | 'Paragraph' | 'Table' {
    return this.loadedProperty<StyleType>('type');
  }

  /** False when the styles part marks the style as custom. */
  get builtIn(): boolean {
    return this.loadedProperty<boolean>('builtIn');
  }

  /**
   * The name of the style this one is based on: a listed style of the same kind. An empty string
   * when the style states none or names any other style. Read-only here.
   */
  get baseStyle(): string {
    return this.loadedProperty<string>('baseStyle');
  }

  /**
   * The name of the style for the paragraph after this one: always a listed paragraph style. A
   * paragraph style that states no next style names itself. An empty string for other kinds, and
   * where the next style it names is not a listed paragraph style. Read-only here.
   */
  get nextParagraphStyle(): string {
    return this.loadedProperty<string>('nextParagraphStyle');
  }

  /**
   * Whether the style is linked to its partner: a paragraph style to a listed character style, or a
   * character style to a listed paragraph style. Other kinds, and links to the same kind or to
   * itself, read false.
   */
  get linked(): boolean {
    return this.loadedProperty<boolean>('linked');
  }

  /**
   * Whether the style shows as a recommended style. False when the styles part marks it
   * semi-hidden or hidden; true when it marks neither. Read-only here.
   */
  get visibility(): boolean {
    return this.loadedProperty<boolean>('visibility');
  }

  /**
   * The sort order of the style among recommended styles; lower comes first. 99 when the styles
   * part states no priority. Read-only here.
   */
  get priority(): number {
    return this.loadedProperty<number>('priority');
  }

  /** Whether the style is in the quick style gallery. False when not stated. Read-only here. */
  get quickStyle(): boolean {
    return this.loadedProperty<boolean>('quickStyle');
  }

  /**
   * Whether a hidden style becomes visible once it is used. False when not stated. Read-only here.
   */
  get unhideWhenUsed(): boolean {
    return this.loadedProperty<boolean>('unhideWhenUsed');
  }

  /** @internal The lookup found this style. */
  hydrateFound(style: AutomationStyleRead): void {
    this.#id = style.id;
    this.path.resolveTo(this.internals.roots().document);
    const awaiting = this.#captured ?? this.#awaiting;
    this.#captured = undefined;
    this.#awaiting = undefined;
    if (awaiting) this.hydrateProperties(style, [...awaiting]);
  }

  /** @internal The lookup found nothing. */
  hydrateNull(): void {
    this.#captured = undefined;
    this.#awaiting = undefined;
    this.path.resolveNull();
  }

  /**
   * @internal The sync took the lookup. The properties awaiting it are its answer's to fill; a load
   * after this point queues its own read by id, so it is never left waiting on a sync that has
   * already been sent, or that fails.
   */
  lookupCaptured(): void {
    this.#captured = this.#awaiting;
    this.#awaiting = undefined;
  }

  /** @internal The lookup's batch ended; later loads read by id. */
  lookupEnded(): void {
    this.#captured = undefined;
    this.#awaiting = undefined;
  }

  /** @internal Record the selected properties from one listing entry. */
  hydrateProperties(style: AutomationStyleRead, selected: readonly string[]): void {
    for (const property of selected as readonly StyleProperty[])
      this.setLoadedProperty(property, propertyOf(style, property));
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    const selected = this.selection(request, PROPERTIES);
    // A lookup still on its way answers these properties itself, from the same entry.
    if (this.#awaiting) {
      for (const property of selected) this.#awaiting.add(property);
      return;
    }
    const target = this.path.label;
    this.read(
      target,
      () => {
        // A listed style has its id from the start; a looked-up one has it once its lookup's
        // sync answered. Asking by id answers one entry, not the whole listing.
        const id = this.#id;
        if (id === undefined) fail({ code: 'ItemNotFound', target });
        return { op: 'getStyles', id };
      },
      (value) => {
        const style = hydratedStyles(value, target)[0];
        if (!style) fail({ code: 'ItemNotFound', target });
        this.hydrateProperties(style, selected);
      }
    );
  }
}

/**
 * The styles a document defines, of every kind, in the order its styles part writes them, as of
 * the sync that loaded them.
 *
 * The listing holds paragraph, character, table, and list styles. The `paragraph.style`,
 * `range.style`, and `body.style` setters accept paragraph style names only; they refuse character,
 * table, and list names. Check `type` before assigning a `nameLocal`. Every listed paragraph style
 * applies through those setters. Styles with no name, an invalid name, or an unknown kind are not
 * listed. A document with no styles part lists none.
 *
 * `load()` with no arguments, or `load('items')`, reads every property of each style in the same
 * sync. Name `items/` paths to read fewer, such as `styles.load('items/nameLocal,items/type')`.
 *
 * @public
 */
export class StyleCollection extends ModelObject {
  /** Loads queued in the current sync, which a repeated load joins. */
  readonly #loads = new CollectionLoads();

  /** @internal The styles of the document `owner` names. */
  static of(context: RequestContext, label: string, owner: ObjectPath): StyleCollection {
    return new StyleCollection(context, ObjectPath.derived(label, owner));
  }

  private constructor(context: RequestContext, path: ObjectPath) {
    super(context, path);
  }

  /** The styles this collection was loaded with. `PropertyNotLoaded` before a synced load. */
  get items(): readonly Style[] {
    return this.loadedProperty<readonly Style[]>('items');
  }

  /** The number of listed styles, of every kind, readable after the next sync. */
  getCount(): ClientResult<number> {
    const target = `${this.path.label}.getCount`;
    const { result, fill } = clientResult<number>(target);
    this.read(
      target,
      () => ({ op: 'getStyles', count: true }),
      (value) => fill(hydratedNumber(value, target))
    );
    return result;
  }

  /**
   * The style with this name, or an object that reports `isNullObject` after the sync. Reading
   * `isNullObject` needs no property load; properties loaded on the object before that sync are
   * answered by the same lookup.
   *
   * Names compare without case and surrounding spaces, the way the style setters compare them.
   * When one name belongs to styles of several kinds, the paragraph style is answered, because that
   * is the style the setters apply. Otherwise the first match in part order is answered.
   */
  getByNameOrNullObject(name: string): Style {
    const target = `${this.path.label}.getByNameOrNullObject`;
    // Refused at the call, where the mistake is, rather than at the sync.
    if (typeof name !== 'string') fail({ code: 'InvalidArgument', target });
    const found = Style.promised(this.context, target);
    this.enqueue({
      sort: 'read',
      label: target,
      plan: () => ({ op: 'getStyles', name }),
      // Loads on `found` in this sync are answered by this read's own entry.
      settle: (value) => {
        const style = hydratedStyles(value, target)[0];
        if (style) found.hydrateFound(style);
        else found.hydrateNull();
      },
      capture: () => found.lookupCaptured(),
      dispose: () => found.lookupEnded(),
    });
    return found;
  }

  /** @internal Collections accept `items/<property>` paths. */
  protected override get loadsItemPaths(): boolean {
    return true;
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    const label = `${this.path.label}.items`;
    const named = collectionItemSelection(request);
    // Refused at the `load` call, before anything is sent, like every other collection. Naming no
    // item property reads them all, as a collection load does in the reference.
    const itemSelect =
      named.length > 0
        ? selectedProperties({ select: named, itemSelect: [] }, PROPERTIES, label)
        : PROPERTIES;
    const skip = request.skip ?? 0;
    const top = request.top;
    // A repeated load in the same sync joins this one, so one listing answers every selection.
    if (this.#loads.join(itemSelect, skip, top)) return;
    this.#loads.open(skip, top, (shared, release) =>
      this.enqueue({
        sort: 'read',
        label,
        capture: release,
        dispose: release,
        plan: () => ({ op: 'getStyles' }),
        settle: (value) => {
          const styles = hydratedStyles(value, label);
          const names = [...shared];
          const last = windowEnd(styles.length, skip, top);
          const items: Style[] = [];
          for (let index = skip; index < last; index += 1) {
            const style = styles[index]!;
            const item = Style.listed(this.context, `${label}[${String(index)}]`, this.path, style);
            item.hydrateProperties(style, names);
            items.push(item);
          }
          this.setLoadedProperty('items', Object.freeze(items));
        },
      })
    );
  }
}

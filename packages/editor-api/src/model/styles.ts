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
// at once, and a name lookup would hand back whichever came first.
//
// NOT EVERY LISTED NAME IS A PARAGRAPH STYLE. The listing holds every kind. The paragraph and range
// `style` setters accept paragraph style names only, and refuse character, table, and list names.
//
// READS ONLY. Writing a style definition (its font, its paragraph format, deleting it, adding one)
// is not something this API does, so those members are not published at all. `baseStyle` and
// `nextParagraphStyle` are readable and have no setter.

import { foldStyleName } from '@docx-editor.dev/core/automation';
import {
  ObjectPath,
  clientResult,
  type ClientResult,
  fail,
  hydratedStyles,
  selectedProperties,
  type AutomationStyleRead,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { collectionItemSelection } from './item-collection.ts';
import { ModelObject } from './model-object.ts';

/** The kind of a style. @public */
export enum StyleType {
  /** A character style. The paragraph `style` setters refuse its name. */
  character = 'Character',
  /** A numbering style, which defines list formatting. The paragraph `style` setters refuse its name. */
  list = 'List',
  /** A paragraph style, which `paragraph.style` accepts by its `nameLocal`. */
  paragraph = 'Paragraph',
  /** A table style. The paragraph `style` setters refuse its name. */
  table = 'Table',
}

const PROPERTIES = [
  'nameLocal',
  'type',
  'builtIn',
  'baseStyle',
  'nextParagraphStyle',
  'linked',
] as const;
type StyleProperty = (typeof PROPERTIES)[number];

const TYPES: Readonly<Record<AutomationStyleRead['type'], StyleType>> = Object.freeze({
  paragraph: StyleType.paragraph,
  character: StyleType.character,
  table: StyleType.table,
  numbering: StyleType.list,
});

/**
 * The style a name lookup answers. Names compare the way the style setters compare them. Where one
 * name belongs to several kinds, the paragraph style wins, because that is the style the setters
 * apply; otherwise the first match in part order.
 */
function styleNamed(
  styles: readonly AutomationStyleRead[],
  name: string
): AutomationStyleRead | undefined {
  const key = foldStyleName(name);
  const matches = styles.filter((style) => foldStyleName(style.name) === key);
  return matches.find((style) => style.type === 'paragraph') ?? matches[0];
}

function propertyOf(style: AutomationStyleRead, property: StyleProperty): string | boolean {
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
  }
}

/**
 * One style the document's styles part defines. Every property is read-only and needs an explicit
 * `load` before it is read.
 *
 * `nameLocal` is the name the styles part declares. Only a style whose `type` is `Paragraph` can be
 * assigned to `paragraph.style`, `range.style`, or `body.style`; those setters refuse character,
 * table, and list style names.
 *
 * @public
 */
export class Style extends ModelObject {
  /** The style id this object is found by in a later listing, once known. */
  #id: string | undefined;
  /** The name a lookup was asked for, until its sync answers. */
  readonly #lookup: unknown;

  /** @internal A member of a loaded collection. */
  static listed(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    style: AutomationStyleRead
  ): Style {
    const item = new Style(context, ObjectPath.derived(label, owner), undefined, false);
    item.#id = style.id;
    return item;
  }

  /** @internal A style looked up by name; a sync says whether it exists. */
  static promised(context: RequestContext, label: string, name: unknown): Style {
    return new Style(context, ObjectPath.pending(label), name, true);
  }

  private constructor(
    context: RequestContext,
    path: ObjectPath,
    lookup: unknown,
    nullable: boolean
  ) {
    super(context, path, { nullable });
    this.#lookup = lookup;
  }

  /**
   * The name the styles part declares. Assign it to `paragraph.style` only when `type` is
   * `Paragraph`; the paragraph `style` setters refuse other kinds.
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
   * The name of the style this one is based on. An empty string when the style states none, or
   * names a style the listing leaves out. Read-only here.
   */
  get baseStyle(): string {
    return this.loadedProperty<string>('baseStyle');
  }

  /**
   * The name of the style for the paragraph after this one. A paragraph style that states no next
   * style names itself. An empty string for other kinds, and where the next style it names is one
   * the listing leaves out. Read-only here.
   */
  get nextParagraphStyle(): string {
    return this.loadedProperty<string>('nextParagraphStyle');
  }

  /** Whether the style is linked to another listed style. */
  get linked(): boolean {
    return this.loadedProperty<boolean>('linked');
  }

  /** @internal The lookup found this style. */
  hydrateFound(style: AutomationStyleRead): void {
    this.#id = style.id;
    this.path.resolveTo(this.internals.roots().document);
  }

  /** @internal The lookup found nothing. */
  hydrateNull(): void {
    this.path.resolveNull();
  }

  /** @internal Record the selected properties from one listing entry. */
  hydrateProperties(style: AutomationStyleRead, selected: readonly string[]): void {
    for (const property of selected as readonly StyleProperty[])
      this.setLoadedProperty(property, propertyOf(style, property));
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    const selected = this.selection(request, PROPERTIES);
    const target = this.path.label;
    this.read(
      target,
      () => ({ op: 'getStyles' }),
      (value) => {
        const styles = hydratedStyles(value, target);
        // The id when a listing or a lookup has named this style; the asked-for name only for a
        // lookup whose own answer has not arrived, which the queue orders before this read.
        const style =
          this.#id !== undefined
            ? styles.find((entry) => entry.id === this.#id)
            : typeof this.#lookup === 'string'
              ? styleNamed(styles, this.#lookup)
              : undefined;
        if (!style) fail({ code: 'ItemNotFound', target });
        this.#id = style.id;
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
 * Load the styles and a property of each in one sync with an `items/` path, such as
 * `styles.load('items/nameLocal,items/type')`.
 *
 * @public
 */
export class StyleCollection extends ModelObject {
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
      () => ({ op: 'getStyles' }),
      (value) => fill(hydratedStyles(value, target).length)
    );
    return result;
  }

  /**
   * The style with this name, or an object that reports `isNullObject` after the sync.
   *
   * Names compare without case and surrounding spaces, the way the style setters compare them.
   * When one name belongs to styles of several kinds, the paragraph style is answered, because that
   * is the style the setters apply. Otherwise the first match in part order is answered.
   */
  getByNameOrNullObject(name: string): Style {
    const target = `${this.path.label}.getByNameOrNullObject`;
    const found = Style.promised(this.context, target, name);
    this.read(
      target,
      () => {
        if (typeof name !== 'string') fail({ code: 'InvalidArgument', target });
        return { op: 'getStyles' };
      },
      (value) => {
        const style = styleNamed(hydratedStyles(value, target), name);
        if (style) found.hydrateFound(style);
        else found.hydrateNull();
      }
    );
    return found;
  }

  /** @internal Collections accept `items/<property>` paths. */
  protected override get loadsItemPaths(): boolean {
    return true;
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    const label = `${this.path.label}.items`;
    const itemSelect = collectionItemSelection(request);
    // Refused at the `load` call, before anything is sent, like every other collection.
    if (itemSelect.length > 0)
      selectedProperties({ select: itemSelect, itemSelect: [] }, PROPERTIES, label);
    const skip = request.skip ?? 0;
    const top = request.top;
    this.read(
      label,
      () => ({ op: 'getStyles' }),
      (value) => {
        const styles = hydratedStyles(value, label);
        const last = top === undefined ? styles.length : Math.min(styles.length, skip + top);
        const items: Style[] = [];
        for (let index = skip; index < last; index += 1) {
          const style = styles[index]!;
          const item = Style.listed(this.context, `${label}[${String(index)}]`, this.path, style);
          item.hydrateProperties(style, itemSelect);
          items.push(item);
        }
        this.setLoadedProperty('items', Object.freeze(items));
      }
    );
  }
}

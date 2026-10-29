/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The styles a document defines, read so a caller can choose one by name.
//
// A STYLE IS NOT AN OBJECT THE HOST NAMES. The host answers one listing of `styles.xml`, as plain
// data, and every object here reads its values from such a listing. A style is found again by its
// NAME, compared the way a `style` write compares it, so the name a listing answers is always one
// `paragraph.style = …` accepts.
//
// READS ONLY. Writing a style definition (its font, its paragraph format, deleting it, adding one)
// is not something this API does, so those members are not published at all. `baseStyle` and
// `nextParagraphStyle` are readable and have no setter.

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
import { ModelObject } from './model-object.ts';

/** The kind of a style. @public */
export enum StyleType {
  character = 'Character',
  list = 'List',
  paragraph = 'Paragraph',
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

/** How a name is compared: the rule the paragraph `style` setter uses. */
function folded(name: string): string {
  return name.trim().toLowerCase();
}

/** The first style a listing holds under `name`, or undefined. */
function styleNamed(
  styles: readonly AutomationStyleRead[],
  name: string
): AutomationStyleRead | undefined {
  const key = folded(name);
  return styles.find((style) => folded(style.name) === key);
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
      // A paragraph style that states no `w:next` is followed by itself.
      return style.next ?? (style.type === 'paragraph' ? style.name : '');
    case 'linked':
      return style.linked;
  }
}

/**
 * One style the document's styles part defines. Every property is read-only and needs an explicit
 * `load` before it is read.
 *
 * `nameLocal` is the name the styles part declares. Assign it to `paragraph.style` to apply a
 * listed paragraph style.
 *
 * @public
 */
export class Style extends ModelObject {
  /** The name this style is found by in a later listing. */
  #name: unknown;

  /** @internal A member of a loaded collection. */
  static listed(context: RequestContext, label: string, owner: ObjectPath): Style {
    return new Style(context, ObjectPath.derived(label, owner), undefined, false);
  }

  /** @internal A style looked up by name; a sync says whether it exists. */
  static promised(context: RequestContext, label: string, name: unknown): Style {
    return new Style(context, ObjectPath.pending(label), name, true);
  }

  private constructor(context: RequestContext, path: ObjectPath, name: unknown, nullable: boolean) {
    super(context, path, { nullable });
    this.#name = name;
  }

  /** The name the styles part declares. */
  get nameLocal(): string {
    return this.loadedProperty<string>('nameLocal');
  }

  /** The kind of style. A numbering definition style reads as `List`. */
  get type(): StyleType | 'Character' | 'List' | 'Paragraph' | 'Table' {
    return this.loadedProperty<StyleType>('type');
  }

  /** False when the styles part marks the style as custom. */
  get builtIn(): boolean {
    return this.loadedProperty<boolean>('builtIn');
  }

  /** The name of the style this one is based on, or an empty string. Read-only here. */
  get baseStyle(): string {
    return this.loadedProperty<string>('baseStyle');
  }

  /**
   * The name of the style for the paragraph after this one. A paragraph style that states none
   * names itself; other kinds read an empty string. Read-only here.
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
    this.#name = style.name;
    this.path.resolveTo(this.internals.roots().document);
  }

  /** @internal The lookup found nothing. */
  hydrateNull(): void {
    this.path.resolveNull();
  }

  /** @internal Record the selected properties from one listing entry. */
  hydrateProperties(style: AutomationStyleRead, selected: readonly string[]): void {
    this.#name = style.name;
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
        const name = this.#name;
        const styles = hydratedStyles(value, target);
        const style = typeof name === 'string' ? styleNamed(styles, name) : undefined;
        if (!style) fail({ code: 'ItemNotFound', target });
        this.hydrateProperties(style, selected);
      }
    );
  }
}

/**
 * The styles a document defines, in the order its styles part writes them, as of the sync that
 * loaded them.
 *
 * A style is listed when its name is one the `style` setters accept. A paragraph style is listed
 * only when assigning its `nameLocal` to `paragraph.style` applies it. A document with no styles
 * part lists none.
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

  /** The number of styles the document defines, readable after the next sync. */
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
   * The style with this name, compared without case and surrounding spaces, or an object that
   * reports `isNullObject` after the sync.
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
    // `items` is the collection's only property; any other name selects it on each item.
    const label = `${this.path.label}.items`;
    selectedProperties(
      { ...request, select: request.select.filter((name) => name === 'items') },
      ['items'],
      this.path.label
    );
    const itemSelect = [
      ...new Set([...request.select.filter((name) => name !== 'items'), ...request.itemSelect]),
    ];
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
          const item = Style.listed(this.context, `${label}[${String(index)}]`, this.path);
          item.hydrateProperties(styles[index]!, itemSelect);
          items.push(item);
        }
        this.setLoadedProperty('items', Object.freeze(items));
      }
    );
  }
}

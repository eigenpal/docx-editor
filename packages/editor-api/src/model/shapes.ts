/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Floating and inline shapes, and the text-box stories they hold.
//
// A SHAPE IS NAMED BY THE DOCUMENT. Its `id` is the number the file gives the drawing, and it is
// listed by the body or paragraph that anchors it. A text box's `body` is an ordinary `Body`:
// paragraphs, text, search and edits through the same operations as the main story, so no second
// vocabulary exists for text inside a box. Any other shape has no body, and asking for one
// refuses at the sync rather than answering an empty story.

import {
  ObjectPath,
  fail,
  hydratedHandle,
  hydratedHandles,
  type AutomationOperation,
  type AutomationValue,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { spanRefOf, type SpanOwner } from './addressing.ts';
import { Body } from './body.ts';
import { ItemCollection, type PromisedItem } from './item-collection.ts';
import { ModelObject } from './model-object.ts';

/** Word's shape types. Only a text box has a body. @public */
export enum ShapeType {
  unsupported = 'Unsupported',
  textBox = 'TextBox',
  geometricShape = 'GeometricShape',
  group = 'Group',
  picture = 'Picture',
  canvas = 'Canvas',
}

const FIELDS = ['id', 'name', 'type'] as const;
const SHAPE_TYPES: ReadonlySet<string> = new Set(Object.values(ShapeType));

/**
 * One floating or inline shape in a body or paragraph.
 *
 * `id`, `name` and `type` are read-only. {@link Shape.body} is the text-box story for a
 * `TextBox` shape; any other shape refuses it at the sync.
 *
 * @public
 */
export class Shape extends ModelObject implements PromisedItem {
  #body: Body | undefined;

  /** @internal */
  static at(context: RequestContext, label: string, address: ObjectAddress): Shape {
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: label });
    return new Shape(context, ObjectPath.of(label, address.handle), false);
  }

  /** @internal */
  static promised(context: RequestContext, label: string, nullable: boolean): Shape {
    return new Shape(context, ObjectPath.pending(label), nullable);
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

  /** The shape's id in the document. */
  get id(): number {
    return this.loadedProperty<number>('id');
  }

  /** The shape's name in the document. */
  get name(): string {
    return this.loadedProperty<string>('name');
  }

  /** The shape's type. */
  get type(): ShapeType {
    return this.loadedProperty<ShapeType>('type');
  }

  /** The text box's own story. Refuses at the sync for a shape that is not a text box. */
  get body(): Body {
    if (this.#body) return this.#body;
    const label = `${this.path.label}.body`;
    const story = Body.promisedStory(this.context, label);
    this.read(
      label,
      () => ({ op: 'getShapeBody', shape: this.#handle() }),
      (value) => {
        story.hydrateAddress({ kind: 'handle', handle: hydratedHandle(value, label) });
      }
    );
    this.#body = story;
    return story;
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    const selected = this.selection(request, FIELDS);
    if (!selected.length) return;
    this.read(
      this.path.label,
      () => ({ op: 'getShape', shape: this.#handle() }),
      (value) => {
        if (value.kind !== 'shape' || !SHAPE_TYPES.has(value.shape.type))
          fail({ code: 'GeneralException', target: this.path.label });
        for (const field of selected as readonly (typeof FIELDS)[number][])
          this.setLoadedProperty(field, value.shape[field]);
      }
    );
  }

  #handle() {
    this.requireAddressable();
    return this.path.handle();
  }
}

/**
 * The floating and inline shapes in a body or paragraph, in reading order.
 *
 * @public
 */
export class ShapeCollection extends ItemCollection<Shape> {
  readonly #owner: SpanOwner;
  readonly #types: readonly ShapeType[] | undefined;

  /** @internal */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    kind: SpanOwner,
    types?: readonly ShapeType[]
  ): ShapeCollection {
    return new ShapeCollection(context, ObjectPath.derived(label, owner), kind, types);
  }

  private constructor(
    context: RequestContext,
    path: ObjectPath,
    owner: SpanOwner,
    types: readonly ShapeType[] | undefined
  ) {
    super(context, path);
    this.#owner = owner;
    this.#types = types;
  }

  /** The first shape. `ItemNotFound` at the sync when there is none. */
  getFirst(): Shape {
    return this.edge('first', 'getFirst', false);
  }

  /** The first shape, or a null object when there is none. */
  getFirstOrNullObject(): Shape {
    return this.edge('first', 'getFirstOrNullObject', true);
  }

  /** The shapes of the given types, in the same order. */
  getByTypes(types: ShapeType[]): ShapeCollection {
    const label = `${this.path.label}.getByTypes`;
    if (!Array.isArray(types) || types.some((type) => !SHAPE_TYPES.has(type)))
      fail({ code: 'InvalidArgument', target: label });
    // Chained filters narrow: a shape must match every filter on the way down.
    const narrowed = this.#types ? this.#types.filter((type) => types.includes(type)) : [...types];
    return ShapeCollection.of(this.context, label, this.path, this.#owner, narrowed);
  }

  /** @internal */
  protected listing(): AutomationOperation {
    const span = spanRefOf(this.path, this.#owner);
    return this.#types ? { op: 'getShapes', span, types: this.#types } : { op: 'getShapes', span };
  }

  /** @internal */
  protected size(value: AutomationValue, label: string): number {
    return hydratedHandles(value, label).length;
  }

  /** @internal */
  protected addressAt(
    value: AutomationValue,
    label: string,
    index: number
  ): ObjectAddress | undefined {
    const handle = hydratedHandles(value, label)[index];
    return handle ? { kind: 'handle', handle } : undefined;
  }

  /** @internal */
  protected itemAt(label: string, address: ObjectAddress): Shape {
    return Shape.at(this.context, label, address);
  }

  /** @internal */
  protected promised(label: string, nullable: boolean): Shape & PromisedItem {
    return Shape.promised(this.context, label, nullable);
  }
}

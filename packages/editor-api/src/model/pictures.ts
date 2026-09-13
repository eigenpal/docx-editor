/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  ObjectPath,
  fail,
  hydratedApplied,
  hydratedHandles,
  type AutomationOperation,
  type AutomationValue,
  type ObjectAddress,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { spanRefOf, type SpanOwner } from './addressing.ts';
import { ModelObject } from './model-object.ts';
import { ItemCollection, type PromisedItem } from './item-collection.ts';

const FIELDS = ['width', 'height', 'lockAspectRatio', 'altTextDescription'] as const;
type PictureWrite = {
  width?: number;
  height?: number;
  lockAspectRatio?: boolean;
  altTextDescription?: string;
};

/** An inline PNG or JPEG picture. Measurements use points. @public */
export class InlinePicture extends ModelObject implements PromisedItem {
  #pending: PictureWrite | undefined;
  /** @internal */
  static at(context: RequestContext, label: string, address: ObjectAddress): InlinePicture {
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: label });
    return new InlinePicture(context, ObjectPath.of(label, address.handle), false);
  }
  /** @internal */
  static promised(context: RequestContext, label: string, nullable: boolean): InlinePicture {
    return new InlinePicture(context, ObjectPath.pending(label), nullable);
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
  get width(): number {
    return this.loadedProperty<number>('width');
  }
  set width(value: number) {
    this.#number('width', value);
  }
  get height(): number {
    return this.loadedProperty<number>('height');
  }
  set height(value: number) {
    this.#number('height', value);
  }
  get lockAspectRatio(): boolean {
    return this.loadedProperty<boolean>('lockAspectRatio');
  }
  set lockAspectRatio(value: boolean) {
    if (typeof value !== 'boolean')
      fail({ code: 'InvalidArgument', target: `${this.path.label}.lockAspectRatio` });
    this.#author({ lockAspectRatio: value });
  }
  get altTextDescription(): string {
    return this.loadedProperty<string>('altTextDescription');
  }
  set altTextDescription(value: string) {
    if (typeof value !== 'string')
      fail({ code: 'InvalidArgument', target: `${this.path.label}.altTextDescription` });
    this.#author({ altTextDescription: value });
  }
  /** Delete this picture. Shared media relationships remain preserved. */
  delete(): void {
    const target = `${this.path.label}.delete`;
    this.commandAnswering(
      target,
      () => ({ op: 'deleteInlinePicture', picture: this.#handle() }),
      (value) => hydratedApplied(value, target)
    );
  }
  protected override onLoad(request: ResolvedLoadOptions): void {
    const selected = this.selection(request, FIELDS);
    if (!selected.length) return;
    this.read(
      this.path.label,
      () => ({ op: 'getInlinePicture', picture: this.#handle() }),
      (value) => {
        if (value.kind !== 'inlinePicture')
          fail({ code: 'GeneralException', target: this.path.label });
        for (const field of selected as readonly (typeof FIELDS)[number][])
          this.setLoadedProperty(field, value.picture[field]);
      }
    );
  }
  #number(field: 'width' | 'height', value: number): void {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
      fail({ code: 'InvalidArgument', target: `${this.path.label}.${field}` });
    this.#author({ [field]: value });
  }
  #author(value: PictureWrite): void {
    this.requireUsablePath();
    if (this.#pending) {
      Object.assign(this.#pending, value);
      return;
    }
    const pending = value;
    this.#pending = pending;
    this.commandAnswering(
      this.path.label,
      () => {
        return { op: 'setInlinePicture', picture: this.#handle(), properties: pending };
      },
      (answer) => hydratedApplied(answer, this.path.label),
      () => {
        if (this.#pending === pending) this.#pending = undefined;
      }
    );
  }
  #handle() {
    this.requireAddressable();
    const address = this.path.address();
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: this.path.label });
    return address.handle;
  }
}

/** Inline pictures within a body or range. Load items before enumeration. @public */
export class InlinePictureCollection extends ItemCollection<InlinePicture> {
  readonly #owner: SpanOwner;
  /** @internal */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    kind: SpanOwner
  ): InlinePictureCollection {
    return new InlinePictureCollection(context, ObjectPath.derived(label, owner), kind);
  }
  private constructor(context: RequestContext, path: ObjectPath, owner: SpanOwner) {
    super(context, path);
    this.#owner = owner;
  }
  getFirst(): InlinePicture {
    return this.edge('first', 'getFirst', false);
  }
  getLast(): InlinePicture {
    return this.edge('last', 'getLast', false);
  }
  getFirstOrNullObject(): InlinePicture {
    return this.edge('first', 'getFirstOrNullObject', true);
  }
  getLastOrNullObject(): InlinePicture {
    return this.edge('last', 'getLastOrNullObject', true);
  }
  protected listing(): AutomationOperation {
    return { op: 'getInlinePictures', span: spanRefOf(this.path, this.#owner) };
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
  protected itemAt(label: string, address: ObjectAddress): InlinePicture {
    return InlinePicture.at(this.context, label, address);
  }
  protected promised(label: string, nullable: boolean): InlinePicture & PromisedItem {
    return InlinePicture.promised(this.context, label, nullable);
  }
}

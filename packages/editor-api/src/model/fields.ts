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
import { Range } from './range.ts';
import { ItemCollection, type PromisedItem } from './item-collection.ts';

/**
 * An inert Word field. Code writes and evaluation support PAGE and NUMPAGES. A field inside a
 * pending tracked insertion reads, but refuses code writes and `updateResult` until accepted.
 * Its cached result reads and writes through {@link Field.result}.
 *
 * @public
 */
export class Field extends ModelObject implements PromisedItem {
  #pendingCode: { code: string } | undefined;
  #result: Range | undefined;
  /** @internal */
  static at(context: RequestContext, label: string, address: ObjectAddress): Field {
    if (address.kind !== 'handle') fail({ code: 'InvalidObjectPath', target: label });
    return new Field(context, ObjectPath.of(label, address.handle), false);
  }
  /** @internal */
  static promised(context: RequestContext, label: string, nullable: boolean): Field {
    return new Field(context, ObjectPath.pending(label), nullable);
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
  get code(): string {
    return this.loadedProperty<string>('code');
  }
  /**
   * The field's cached result, as a range. Two members work on it: `text` (with
   * `load('text')`, or `field.load('result')`) reads the result, and
   * `insertText(text, 'Replace')` replaces it with plain text and marks the field `w:dirty`, so
   * a reader that evaluates fields recomputes it. The instruction never changes and is never
   * evaluated. Untracked, the field must sit outside every revision. With `TrackMineOnly`, the
   * field must be your own pending insertion, and the result joins it. Every other range
   * member, and every other insert location, refuses with `NotImplemented` and
   * `edit.field-result-unsupported`.
   */
  get result(): Range {
    this.requireUsablePath();
    return (this.#result ??= Range.ofFieldResult(
      this.context,
      `${this.path.label}.result`,
      this.path
    ));
  }
  set code(value: string) {
    this.requireUsablePath();
    if (typeof value !== 'string' || value.length === 0)
      fail({ code: 'InvalidArgument', target: `${this.path.label}.code` });
    if (this.#pendingCode) {
      this.#pendingCode.code = value;
      return;
    }
    const pending = { code: value };
    this.#pendingCode = pending;
    this.commandAnswering(
      `${this.path.label}.code`,
      () => {
        return { op: 'setFieldCode', field: this.#handle(), code: pending.code };
      },
      (value) => hydratedApplied(value, `${this.path.label}.code`),
      () => {
        if (this.#pendingCode === pending) this.#pendingCode = undefined;
      }
    );
  }
  /** Remove this field, including its cached result. Other fields remain inert and unchanged. */
  delete(): void {
    this.#command('deleteField');
  }
  /** Compute a cached result using actual host pagination. Missing pagination refuses explicitly. */
  updateResult(): void {
    this.#command('updateFieldResult');
  }
  #command(op: 'deleteField' | 'updateFieldResult'): void {
    this.requireUsablePath();
    // The label names the call, so a refusal's `errorLocation` ends in `.delete` or
    // `.updateResult`, like every other method's.
    this.commandAnswering(
      `${this.path.label}.${op === 'deleteField' ? 'delete' : 'updateResult'}`,
      () => ({ op, field: this.#handle() }),
      (value) => hydratedApplied(value, this.path.label)
    );
  }
  protected override onLoad(request: ResolvedLoadOptions): void {
    // `result` is a navigation property: only an explicit `load('result')` reads it.
    const selected =
      request.select.length === 0 ? ['code'] : this.selection(request, ['code', 'result']);
    if (selected.includes('result')) this.result.load('text');
    if (!selected.includes('code')) return;
    this.read(
      this.path.label,
      () => ({ op: 'getField', field: this.#handle() }),
      (value) => {
        if (value.kind !== 'field') fail({ code: 'GeneralException', target: this.path.label });
        this.setLoadedProperty('code', value.field.code);
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

/** Fields contained within a body or range. @public */
export class FieldCollection extends ItemCollection<Field> {
  readonly #owner: SpanOwner;
  /** @internal */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    kind: SpanOwner
  ): FieldCollection {
    return new FieldCollection(context, ObjectPath.derived(label, owner), kind);
  }
  private constructor(context: RequestContext, path: ObjectPath, owner: SpanOwner) {
    super(context, path);
    this.#owner = owner;
  }
  getFirst(): Field {
    return this.edge('first', 'getFirst', false);
  }
  getLast(): Field {
    return this.edge('last', 'getLast', false);
  }
  getFirstOrNullObject(): Field {
    return this.edge('first', 'getFirstOrNullObject', true);
  }
  getLastOrNullObject(): Field {
    return this.edge('last', 'getLastOrNullObject', true);
  }
  protected listing(): AutomationOperation {
    return { op: 'getFields', span: spanRefOf(this.path, this.#owner) };
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
  protected itemAt(label: string, address: ObjectAddress): Field {
    return Field.at(this.context, label, address);
  }
  protected promised(label: string, nullable: boolean): Field & PromisedItem {
    return Field.promised(this.context, label, nullable);
  }
}

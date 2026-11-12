/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The fill of a shape, a text box, a line, or every shape of a group.
//
// A FILL HAS NO IDENTITY OF ITS OWN. It shares its shape's path, as a font shares its range's: a
// fill reached from a deleted shape refuses at the same moment the shape does.
//
// WRITES IN ONE `sync()` ARE ONE WRITE. `fill.setSolidColor('#4472C4'); fill.transparency = 0.5`
// is one fill change, planned against the same tree, so the second never reads a fill the first
// already replaced. A later `clear()` in the same sync replaces the bag, and a later colour after
// `clear()` replaces the clear, as the calls would one after another.

import {
  ObjectPath,
  fail,
  hydratedApplied,
  hydratedShapeFill,
  type AutomationHandle,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { ModelObject } from './model-object.ts';

/** Office.js shape fill types. @public */
export enum ShapeFillType {
  noFill = 'NoFill',
  solid = 'Solid',
  gradient = 'Gradient',
  pattern = 'Pattern',
  picture = 'Picture',
  texture = 'Texture',
  mixed = 'Mixed',
}

const FIELDS = ['type', 'foregroundColor', 'transparency'] as const;
type FillField = (typeof FIELDS)[number];
type FillWrite = { clear: true } | { color?: string; transparency?: number };

/**
 * The fill of a shape, a text box, a line, or every shape of a group.
 *
 * `foregroundColor` reads `#RRGGBB` for a solid fill and an empty string otherwise, from the
 * shape's own fill or its style's. `type` reads `Mixed` for a group whose shapes disagree.
 * Writes accept `#RRGGBB` only; a color name refuses with `InvalidArgument`.
 * Pictures, charts and diagrams have no fill to set and refuse at the sync.
 *
 * @public
 */
export class ShapeFill extends ModelObject {
  readonly #shape: () => AutomationHandle;
  #pending: FillWrite | undefined;

  /** @internal The fill of the shape `shape` names. */
  static of(
    context: RequestContext,
    label: string,
    owner: ObjectPath,
    shape: () => AutomationHandle
  ): ShapeFill {
    return new ShapeFill(context, ObjectPath.derived(label, owner), shape);
  }

  private constructor(context: RequestContext, path: ObjectPath, shape: () => AutomationHandle) {
    super(context, path);
    this.#shape = shape;
  }

  /** The fill type. Read-only. */
  get type():
    ShapeFillType | 'Gradient' | 'Mixed' | 'NoFill' | 'Pattern' | 'Picture' | 'Solid' | 'Texture' {
    return this.loadedProperty<ShapeFillType>('type');
  }

  /** The solid fill color as `#RRGGBB`, or an empty string for any other fill. */
  get foregroundColor(): string {
    return this.loadedProperty<string>('foregroundColor');
  }

  set foregroundColor(value: string) {
    this.#author({ color: requireColor(value, `${this.path.label}.foregroundColor`) });
  }

  /** From 0 (opaque) to 1 (clear). 0 for anything but a solid fill. */
  get transparency(): number {
    return this.loadedProperty<number>('transparency');
  }

  set transparency(value: number) {
    if (typeof value !== 'number' || !(value >= 0 && value <= 1))
      fail({ code: 'InvalidArgument', target: `${this.path.label}.transparency` });
    this.#author({ transparency: value });
  }

  /** Remove the fill. A later solid color brings a fill back. */
  clear(): void {
    this.#author({ clear: true });
  }

  /** Fill with one color, `#RRGGBB`. The shape's transparency stays. */
  setSolidColor(color: string): void {
    this.#author({ color: requireColor(color, `${this.path.label}.setSolidColor`) });
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected override onLoad(request: ResolvedLoadOptions): void {
    const selected = this.selection(request, FIELDS);
    if (!selected.length) return;
    this.read(
      this.path.label,
      () => ({ op: 'getShapeFill', shape: this.#shape() }),
      (value) => {
        const fill = hydratedShapeFill(value, this.path.label);
        for (const field of selected as readonly FillField[])
          this.setLoadedProperty(field, fill[field]);
      }
    );
  }

  #author(value: FillWrite): void {
    this.requireUsablePath();
    if (this.#pending) {
      // A clear replaces what came before; a colour or transparency after a clear replaces it.
      if ('clear' in value || 'clear' in this.#pending) this.#replace(value);
      else Object.assign(this.#pending, value);
      return;
    }
    const pending: { value: FillWrite } = { value: { ...value } };
    this.#pending = pending.value;
    this.#replace = (next) => {
      pending.value = { ...next };
      this.#pending = pending.value;
    };
    this.commandAnswering(
      this.path.label,
      () => ({ op: 'setShapeFill', shape: this.#shape(), fill: pending.value }),
      (answer) => hydratedApplied(answer, this.path.label),
      () => {
        if (this.#pending === pending.value) this.#pending = undefined;
      }
    );
  }

  #replace: (next: FillWrite) => void = () => {};
}

function requireColor(value: unknown, target: string): string {
  if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(value))
    fail({ code: 'InvalidArgument', target });
  return value;
}

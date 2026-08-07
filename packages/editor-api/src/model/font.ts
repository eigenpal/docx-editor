/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The character formatting of whatever it belongs to: a story, a stretch of one, or a paragraph.
//
// A FONT HAS NO IDENTITY OF ITS OWN. It is a view onto its owner's characters, so it shares its
// owner's path: a font reached from a range whose paragraph has been deleted refuses for the same
// reason the range does, and at the same moment, rather than holding a stale address of its own.
//
// READING IS AGREEMENT, AND `null` MEANS "NO AGREED VALUE". Every run the owner covers says bold,
// or the answer is null — and null is also the answer when NOTHING in range authors the property.
// The two are one answer on purpose. This lane reads what the document AUTHORS rather than what the
// style cascade computes, so a heading whose bold comes from `styles.xml` reads null: the value a
// write merges against is the direct one, and answering the cascade would let a caller read an
// inherited value, write it straight back, and silently freeze it into the paragraph as if the
// author had chosen it. Upstream answers the effective value in that case; the divergence is
// recorded in `compat/manifest.json`.
//
// ASSIGNMENTS IN ONE `sync()` ARE ONE WRITE. `font.bold = true; font.size = 12` has to be one
// operation, and not as an optimisation: a run-property write carries the run's whole property bag
// so it can replace the container, and a second write planned from the same pre-batch tree would
// carry a bag the first had already superseded. The host refuses that outright
// (`ConflictingChanges`), so the accumulation below is what makes the ordinary Office.js shape
// work. The bag is snapshotted and cleared when the batch is planned, so the next assignment starts
// a new write whether the batch committed or failed.

import {
  ObjectPath,
  fail,
  hydratedApplied,
  hydratedFont,
  type AutomationSpanRef,
  type RequestContext,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';
import { spanRefOf, type SpanOwner } from './addressing.ts';
import { ModelObject } from './model-object.ts';

/** Every property a font both reads and writes. Order is the order a load answers them in. */
const FIELDS = ['bold', 'italic', 'color', 'name', 'size'] as const;

type FontField = (typeof FIELDS)[number];

/**
 * The character formatting of whatever it belongs to: a story, a stretch of one, or a paragraph.
 *
 * A font has no identity of its own — it is a view onto its owner's characters and shares its
 * owner's path, so a font reached from a deleted paragraph's range refuses at the same moment the
 * range does rather than holding a stale address.
 *
 * Reading is AGREEMENT, and `null` means "no agreed value": every run the owner covers says bold,
 * or the answer is null. Null is also the answer when nothing in range authors the property at
 * all. Both are one answer on purpose, because this API reads what the document AUTHORS rather
 * than what the style cascade computes — a heading whose bold comes from `styles.xml` reads null.
 * Answering the cascade would let a caller read an inherited value, write it straight back, and
 * silently freeze it into the paragraph as if the author had chosen it.
 *
 * Assignments within one `sync()` are ONE write: `font.bold = true; font.size = 12` accumulates
 * into a single run-property operation. That is required, not an optimisation — a run-property
 * write carries the run's whole property bag, so a second write planned from the same pre-batch
 * tree would carry a bag the first had already superseded, which the host refuses with
 * `ConflictingChanges`.
 *
 * @public
 */
export class Font extends ModelObject {
  readonly #owner: SpanOwner;
  #pending: Record<string, unknown> | undefined;

  /** @internal The font of the object `owner` addresses. */
  static of(context: RequestContext, label: string, owner: ObjectPath, kind: SpanOwner): Font {
    return new Font(context, ObjectPath.derived(label, owner), kind);
  }

  private constructor(context: RequestContext, path: ObjectPath, owner: SpanOwner) {
    super(context, path);
    this.#owner = owner;
  }

  /** Whether every character agrees it is bold, or `null` where they do not. */
  get bold(): boolean | null {
    return this.loadedProperty<boolean | null>('bold');
  }

  set bold(value: boolean) {
    this.#author('bold', requireBoolean(value, `${this.path.label}.bold`));
  }

  /** Whether every run in range is italic. `null` where they disagree or none says. */
  get italic(): boolean | null {
    return this.loadedProperty<boolean | null>('italic');
  }

  set italic(value: boolean) {
    this.#author('italic', requireBoolean(value, `${this.path.label}.italic`));
  }

  /** `#RRGGBB`. `null` where the characters disagree, or where the colour is `auto`. */
  get color(): string | null {
    return this.loadedProperty<string | null>('color');
  }

  set color(value: string) {
    this.#author('color', requireString(value, `${this.path.label}.color`));
  }

  /** The typeface name the characters state, or `null` where they do not agree on one. */
  get name(): string | null {
    return this.loadedProperty<string | null>('name');
  }

  set name(value: string) {
    this.#author('name', requireString(value, `${this.path.label}.name`));
  }

  /** Points. */
  get size(): number | null {
    return this.loadedProperty<number | null>('size');
  }

  set size(value: number) {
    this.#author('size', requireNumber(value, `${this.path.label}.size`));
  }

  /**
   * One read for every property asked for.
   *
   * They all come out of the same runs, so asking for them one at a time would send several
   * operations about the same characters and make a caller's cost depend on how many fields they
   * happened to name.
   */
  protected override onLoad(request: ResolvedLoadOptions): void {
    const selected = this.selection(request, FIELDS);
    if (selected.length === 0) return;
    const label = `${this.path.label}.font`;
    this.read(
      label,
      () => ({ op: 'getFont', span: this.#span() }),
      (value) => {
        const font = hydratedFont(value, label);
        for (const field of selected as readonly FontField[]) {
          this.setLoadedProperty(field, font[field]);
        }
      }
    );
  }

  #author(field: FontField, value: unknown): void {
    this.requireAddressable();
    if (this.#pending) {
      this.#pending[field] = value;
      return;
    }
    const pending: Record<string, unknown> = { [field]: value };
    this.#pending = pending;
    const label = `${this.path.label}.${field}`;
    this.commandAnswering(
      this.path.label,
      () => {
        // Snapshotted and cleared AT DISPATCH: whatever else was assigned before this sync is in
        // the bag, and whatever is assigned after it belongs to the next batch.
        this.#pending = undefined;
        return { op: 'setFont', span: this.#span(), font: pending };
      },
      (answer) => {
        hydratedApplied(answer, label);
      }
    );
  }

  /** How the owner is spelled to the host, read at plan time so a late release still refuses. */
  #span(): AutomationSpanRef {
    this.requireAddressable();
    return spanRefOf(this.path, this.#owner);
  }
}

function requireBoolean(value: unknown, target: string): boolean {
  if (typeof value !== 'boolean') fail({ code: 'InvalidArgument', target });
  return value;
}

function requireNumber(value: unknown, target: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail({ code: 'InvalidArgument', target });
  }
  return value;
}

function requireString(value: unknown, target: string): string {
  if (typeof value !== 'string' || value.length === 0) fail({ code: 'InvalidArgument', target });
  return value;
}

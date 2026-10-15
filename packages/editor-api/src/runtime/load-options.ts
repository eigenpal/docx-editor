/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What `load(...)` accepts, and what it refuses.
//
// Three call shapes, because that is what a batching object model is asked for in practice:
// `load('text')`, `load(['text', 'style'])` and `load({ select: 'text', top: 5 })`. They all
// resolve to one record so an object's load planner has a single shape to read.
//
// REFUSAL IS THE POINT. A misspelled option key is the difference between "load selected
// properties" and "load nothing", and silently ignoring it produces a `PropertyNotLoaded` later
// at a call that looks correct. So an unknown key, a non-integer `top`, a property name that is
// not an identifier, or a value of the wrong type is `InvalidArgument` HERE, naming the option.
//
// Selected names are never used as object keys anywhere in this runtime — loaded values live in
// a `Map` — so `__proto__` as a property name is inert by construction rather than by filtering.
// It is still refused, because it is not a property any object of this API has.

import { fail } from './errors.ts';

/**
 * The object form of `load(...)`: which properties, and how much of a collection.
 *
 * An unknown key, a non-integer `top`, a property name that is not an identifier, or a value of
 * the wrong type is refused as `InvalidArgument` here, naming the option — a misspelled key is
 * the difference between "load selected properties" and "load nothing", which would otherwise
 * surface as a `PropertyNotLoaded` much later at a call that looks correct.
 *
 * @public
 */
export interface LoadQueryOptions {
  /** Which properties to load. */
  readonly select?: string | readonly string[];
  /**
   * Reserved for Office.js source compatibility. Navigation-property expansion is not supported
   * yet: a non-empty value is refused as `InvalidArgument`. Omit it or pass an empty array.
   */
  readonly expand?: string | readonly string[];
  /** For a collection: at most this many items. */
  readonly top?: number;
  /** For a collection: skip this many items first. */
  readonly skip?: number;
}

/**
 * Everything `load(...)` accepts: one property name, several, or a
 * {@link LoadQueryOptions} object.
 *
 * @example
 * ```ts
 * paragraph.load('text');
 * paragraph.load(['text', 'style']);
 * paragraphs.load({ select: 'items', top: 5 });
 * paragraphs.load('items/text,items/style');
 * ```
 *
 * On a collection, `items/<property>` loads `items` and that property on each item in the same
 * `context.sync()`. A property name without the `items/` prefix means the same thing on a
 * collection, so `paragraphs.load('text')` equals `paragraphs.load('items/text')`.
 *
 * Only one level of navigation is supported. A deeper path, such as `items/font/bold`, and a
 * navigation path on an object that is not a collection, such as `font/bold`, are refused as
 * `InvalidArgument`, with the path as the error's `target`. Load the navigation object itself
 * instead, for example `paragraph.font.load('bold')` for each item.
 *
 * @public
 */
export type LoadOption = string | readonly string[] | LoadQueryOptions;

export interface ResolvedLoadOptions {
  /** Selected property names. Empty means "this object's default set". */
  readonly select: readonly string[];
  /**
   * Property names selected with an `items/` path, to load on each item of a collection. Empty
   * when none was named. An object that is not a collection refuses a non-empty list.
   */
  readonly itemSelect: readonly string[];
  readonly top?: number;
  readonly skip?: number;
}

const KNOWN_KEYS = new Set(['select', 'expand', 'top', 'skip']);
const PROPERTY_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

/** The prefix that selects a property on each item of a collection. */
const ITEMS_PATH = 'items/';
/** Paths longer than this are refused without naming them in the target. */
const MAX_NAMED_SEGMENTS = 4;
const MAX_SEGMENT_LENGTH = 64;

interface SelectedNames {
  readonly own: readonly string[];
  readonly items: readonly string[];
}

/**
 * One selected entry: its own property, an `items/<property>` path, or a refusal.
 *
 * A short path whose segments are all identifiers is named in the refusal's target, so the error
 * says which path is outside the supported depth. Anything else is refused against the loaded
 * object alone, because the target must never echo an arbitrary value.
 */
function classify(entry: unknown, target: string): { own?: string; item?: string } {
  if (typeof entry !== 'string') fail({ code: 'InvalidArgument', target });
  if (PROPERTY_NAME.test(entry)) return { own: entry };
  const segments = entry.split('/', MAX_NAMED_SEGMENTS + 1);
  const named =
    segments.length <= MAX_NAMED_SEGMENTS &&
    segments.every(
      (segment) => segment.length <= MAX_SEGMENT_LENGTH && PROPERTY_NAME.test(segment)
    );
  if (!named) fail({ code: 'InvalidArgument', target });
  if (segments.length === 2 && entry.startsWith(ITEMS_PATH)) return { item: segments[1]! };
  fail({ code: 'InvalidArgument', target: `${target}.${entry}` });
}

function names(value: string | readonly string[] | undefined, target: string): SelectedNames {
  if (value === undefined) return { own: [], items: [] };
  const listed =
    typeof value === 'string'
      ? value.split(',').map((entry) => entry.trim())
      : Array.isArray(value)
        ? value.map((entry) => (typeof entry === 'string' ? entry.trim() : entry))
        : fail({ code: 'InvalidArgument', target });
  const own: string[] = [];
  const items: string[] = [];
  for (const entry of listed) {
    // An empty entry is what a trailing comma or a stray whitespace string produces. Dropping
    // it silently would make `load(' ')` mean `load()` — "load the default set" — which is the
    // opposite of what was asked for.
    const chosen = classify(entry, target);
    if (chosen.own !== undefined && !own.includes(chosen.own)) own.push(chosen.own);
    if (chosen.item !== undefined && !items.includes(chosen.item)) items.push(chosen.item);
  }
  if (own.length === 0 && items.length === 0) fail({ code: 'InvalidArgument', target });
  return { own, items };
}

function resolved(selected: SelectedNames): Pick<ResolvedLoadOptions, 'select' | 'itemSelect'> {
  return { select: selected.own, itemSelect: selected.items };
}

function count(value: unknown, target: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail({ code: 'InvalidArgument', target });
  }
  return value;
}

function refuseExpand(value: unknown, target: string): void {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return;
  // Expansion is deliberately refused before parsing its names. In particular, nested or very
  // large attacker-controlled values cannot drive recursion or an output allocation here.
  fail({ code: 'InvalidArgument', target });
}

/**
 * One resolved record from any accepted call shape.
 *
 * `target` is the object being loaded, so a refusal names `document.body.paragraphs`, not the
 * offending value — which may well be attacker-influenced data in a consumer's own pipeline.
 */
export function resolveLoadOption(
  option: LoadOption | undefined,
  target: string
): ResolvedLoadOptions {
  if (option === undefined) return { select: [], itemSelect: [] };
  if (typeof option === 'string' || Array.isArray(option)) {
    return resolved(names(option as string | readonly string[], target));
  }
  if (typeof option !== 'object' || option === null) fail({ code: 'InvalidArgument', target });

  const query = option as LoadQueryOptions & Record<string, unknown>;
  for (const key of Object.keys(query)) {
    if (!KNOWN_KEYS.has(key)) fail({ code: 'InvalidArgument', target: `${target}.${key}` });
  }
  refuseExpand(query.expand, `${target}.expand`);
  return {
    ...resolved(names(query.select, `${target}.select`)),
    ...(query.top === undefined ? {} : { top: count(query.top, `${target}.top`) }),
    ...(query.skip === undefined ? {} : { skip: count(query.skip, `${target}.skip`) }),
  };
}

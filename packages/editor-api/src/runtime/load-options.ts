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
 * ```
 *
 * Collections load their `items`; properties such as `text` are loaded on each item after the
 * collection has been synced.
 *
 * @public
 */
export type LoadOption = string | readonly string[] | LoadQueryOptions;

export interface ResolvedLoadOptions {
  /** Selected property names. Empty means "this object's default set". */
  readonly select: readonly string[];
  readonly top?: number;
  readonly skip?: number;
}

const KNOWN_KEYS = new Set(['select', 'expand', 'top', 'skip']);
const PROPERTY_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

function names(value: string | readonly string[] | undefined, target: string): readonly string[] {
  if (value === undefined) return [];
  const listed =
    typeof value === 'string'
      ? value.split(',').map((entry) => entry.trim())
      : Array.isArray(value)
        ? value.map((entry) => (typeof entry === 'string' ? entry.trim() : entry))
        : fail({ code: 'InvalidArgument', target });
  const out: string[] = [];
  for (const entry of listed) {
    // An empty entry is what a trailing comma or a stray whitespace string produces. Dropping
    // it silently would make `load(' ')` mean `load()` — "load the default set" — which is the
    // opposite of what was asked for.
    if (typeof entry !== 'string' || !PROPERTY_NAME.test(entry)) {
      fail({ code: 'InvalidArgument', target });
    }
    if (!out.includes(entry)) out.push(entry);
  }
  if (out.length === 0) fail({ code: 'InvalidArgument', target });
  return out;
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
  if (option === undefined) return { select: [] };
  if (typeof option === 'string' || Array.isArray(option)) {
    return { select: names(option as string | readonly string[], target) };
  }
  if (typeof option !== 'object' || option === null) fail({ code: 'InvalidArgument', target });

  const query = option as LoadQueryOptions & Record<string, unknown>;
  for (const key of Object.keys(query)) {
    if (!KNOWN_KEYS.has(key)) fail({ code: 'InvalidArgument', target: `${target}.${key}` });
  }
  refuseExpand(query.expand, `${target}.expand`);
  return {
    select: names(query.select, `${target}.select`),
    ...(query.top === undefined ? {} : { top: count(query.top, `${target}.top`) }),
    ...(query.skip === undefined ? {} : { skip: count(query.skip, `${target}.skip`) }),
  };
}

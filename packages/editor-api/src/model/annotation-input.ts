/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Proofing annotation input: the Office.js data shapes, their checks, and the text edit that
// `accept()` makes.
//
// EVERY REFUSAL IS AT THE CALL. A critique set is plain data a checker produced, often on a
// server, so a wrong color name or a negative offset is `InvalidArgument` where the caller
// wrote it. The popup resource ids name strings in an add-in manifest, which this runtime has
// no way to resolve: a non-empty one refuses with `NotSupported` rather than being dropped.

import { fail, type AutomationOperation, type AutomationSpan } from '../runtime/model-support.ts';
import {
  CRITIQUE_COLOR_SCHEMES,
  MAX_CRITIQUES_PER_CALL,
  type CritiqueColorSchemeName,
  type CritiqueRecord,
} from '../runtime/annotation-store.ts';

/**
 * The color of a critique mark. In the browser editor `Red` marks a spelling issue and `Blue`
 * and `Green` mark grammar issues for assistive technology.
 *
 * @public
 */
export enum CritiqueColorScheme {
  red = 'Red',
  green = 'Green',
  blue = 'Blue',
  lavender = 'Lavender',
  berry = 'Berry',
}

/**
 * Where an annotation is in its life: on the paragraph (`Created`), or decided with
 * `accept()` (`Accepted`) or `reject()` (`Rejected`).
 *
 * @public
 */
export enum AnnotationState {
  created = 'Created',
  accepted = 'Accepted',
  rejected = 'Rejected',
}

/**
 * What a critique offers the reader.
 *
 * `suggestions` are replacement texts; `accept()` applies the first. The three resource ids
 * name strings in an add-in manifest, which this runtime cannot resolve: pass empty strings.
 * A non-empty resource id refuses the call with `NotSupported` and
 * `debugInfo.innerError.code` `edit.operation-unsupported`.
 *
 * @public
 */
export interface CritiquePopupOptions {
  /** Not supported: pass an empty string. */
  brandingTextResourceId: string;
  /** Not supported: pass an empty string. */
  subtitleResourceId: string;
  /** Replacement texts, best first. Each is one paragraph's text, without a paragraph mark. */
  suggestions: string[];
  /** Not supported: pass an empty string. */
  titleResourceId: string;
}

/**
 * One proofing issue in a paragraph.
 *
 * `start` and `length` count UTF-16 code units of the paragraph's `text` as this runtime
 * reads it, in its revision view. `length` is at least 1.
 *
 * @public
 */
export interface Critique {
  /** The color of the mark. */
  colorScheme: CritiqueColorScheme | 'Red' | 'Green' | 'Blue' | 'Lavender' | 'Berry';
  /** Offset of the issue in the paragraph's `text`. */
  start: number;
  /** Length of the issue, in UTF-16 code units. */
  length: number;
  /** Suggestions for the issue. */
  popupOptions?: CritiquePopupOptions;
}

/**
 * The critiques to place on one paragraph with `Paragraph.insertAnnotations`.
 *
 * @public
 */
export interface AnnotationSet {
  /** The critiques, in any order. Overlapping critiques are allowed. */
  critiques: Critique[];
}

const RESOURCE_IDS = ['brandingTextResourceId', 'subtitleResourceId', 'titleResourceId'] as const;

/** Most suggestions one critique may carry, and the longest suggestion. */
const MAX_SUGGESTIONS = 32;
const MAX_SUGGESTION_LENGTH = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function offset(value: unknown, minimum: number, target: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    fail({ code: 'InvalidArgument', target });
  return value;
}

function suggestionsOf(value: unknown, target: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail({ code: 'InvalidArgument', target });
  for (const name of RESOURCE_IDS) {
    const id = value[name];
    if (id === undefined || id === '') continue;
    if (typeof id !== 'string') fail({ code: 'InvalidArgument', target: `${target}.${name}` });
    // A manifest resource this runtime cannot resolve. Refused, never dropped.
    fail({
      code: 'NotSupported',
      target: `${target}.${name}`,
      diagnostic: 'edit.operation-unsupported',
    });
  }
  const suggestions = value.suggestions;
  if (
    !Array.isArray(suggestions) ||
    suggestions.length > MAX_SUGGESTIONS ||
    suggestions.some((entry) => typeof entry !== 'string' || entry.length > MAX_SUGGESTION_LENGTH)
  )
    fail({ code: 'InvalidArgument', target: `${target}.suggestions` });
  return Object.freeze([...(suggestions as string[])]);
}

/** The checked critiques of a set, in the order given. */
export function critiqueRecords(
  set: unknown,
  target: string
): readonly (CritiqueRecord & { readonly start: number })[] {
  if (!isRecord(set) || !Array.isArray(set.critiques)) fail({ code: 'InvalidArgument', target });
  const critiques = set.critiques as unknown[];
  if (critiques.length > MAX_CRITIQUES_PER_CALL)
    fail({ code: 'NotSupported', target, diagnostic: 'edit.resource-limit' });
  return critiques.map((critique, index) => {
    const at = `${target}.critiques[${String(index)}]`;
    if (!isRecord(critique)) fail({ code: 'InvalidArgument', target: at });
    const colorScheme = critique.colorScheme;
    if (!CRITIQUE_COLOR_SCHEMES.includes(colorScheme as CritiqueColorSchemeName))
      fail({ code: 'InvalidArgument', target: `${at}.colorScheme` });
    return {
      colorScheme: colorScheme as CritiqueColorSchemeName,
      start: offset(critique.start, 0, `${at}.start`),
      length: offset(critique.length, 1, `${at}.length`),
      suggestions: suggestionsOf(critique.popupOptions, `${at}.popupOptions`),
    };
  });
}

/** The critique a read answers: the caller's data, at the annotation's current offset. */
export function critiqueOf(record: {
  readonly critique: CritiqueRecord;
  readonly start: number;
}): Critique {
  const { colorScheme, length, suggestions } = record.critique;
  return {
    colorScheme,
    start: record.start,
    length,
    ...(suggestions === undefined
      ? {}
      : {
          popupOptions: {
            brandingTextResourceId: '',
            subtitleResourceId: '',
            suggestions: [...suggestions],
            titleResourceId: '',
          },
        }),
  };
}

const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

function boundariesOf(text: string): (at: number) => boolean {
  if (segmenter) {
    const starts = new Set<number>([text.length]);
    for (const { index } of segmenter.segment(text)) starts.add(index);
    return (at) => starts.has(at);
  }
  return (at) => {
    if (at <= 0 || at >= text.length) return true;
    const before = text.charCodeAt(at - 1);
    const after = text.charCodeAt(at);
    return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
  };
}

/**
 * The part of `before` that `after` changes, cut at grapheme boundaries of both texts, so a
 * fix edits only the letters that differ and keeps the formatting and tracked changes around
 * them. Offsets are in `before`.
 */
export function differingRange(
  before: string,
  after: string
): { readonly from: number; readonly to: number; readonly text: string } {
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (prefix > 0 || suffix > 0) {
    const inBefore = boundariesOf(before);
    const inAfter = boundariesOf(after);
    while (prefix > 0 && !(inBefore(prefix) && inAfter(prefix))) prefix -= 1;
    while (suffix > 0 && !(inBefore(before.length - suffix) && inAfter(after.length - suffix)))
      suffix -= 1;
  }
  return {
    from: prefix,
    to: before.length - suffix,
    text: after.slice(prefix, after.length - suffix),
  };
}

/**
 * The edit that replaces `text`, which `span` holds one model offset per character, with
 * `suggestion`. `null` when the two are the same.
 */
export function acceptEdit(
  span: AutomationSpan,
  text: string,
  suggestion: string
): AutomationOperation | null {
  const change = differingRange(text, suggestion);
  if (change.from === change.to && change.text === '') return null;
  const point = (at: number) => ({ ...span.start, offset: span.start.offset + at });
  if (change.from === change.to)
    return { op: 'insertText', at: point(change.from), text: change.text };
  return {
    op: 'replaceSpan',
    span: { start: point(change.from), end: point(change.to) },
    text: change.text,
  };
}

// Live evaluation of an allowlisted PAGE-family field nested inside an open complex field's
// atomic cached result, or inside a `w:fldSimple` cache.
//
// Both walks skip such an inner field's cached digits and append the projected per-sheet
// value when the inner field's own `end` closes, so a `STYLEREF` wrapping `PAGE` never stamps
// the producer's saved sheet number onto every page. The tracker is LEVEL-AWARE: it records
// the nesting level whose `separate` armed it, and only that level's matching `end` appends
// and disarms. Everything at a DEEPER level while armed — begins, separates, ends, cached
// text — is part of the replaced inner result and is ignored, so a begin/end pair inside a
// tracked result cannot clear tracking mid-field and drop the digits around it. A second
// `separate` at the tracked level (malformed) is ignored the same way: the matched end still
// appends. Any level 2..MAX_FIELD_NESTING may arm when the walk offers it, so a PAGE three or
// four levels down (under an inert REF, say) still evaluates instead of losing its digits.
//
// In the BODY there is no page context while the paragraph is measured. There the tracker arms
// DEFERRED: the inner field's saved result stays in the text as its width, and the walk records
// a segment marker (`takeDeferred`) so document finalize substitutes each page's value.
//
// This tracker owns only that state: which inner field is armed, at which level, and whether
// its cached result was seen and whether any of it was visible, and the visible text of that
// result, which a formula with no value on the page shows instead. Extracted so the walks stay
// a straight-line reading of the field machine.

import type { AllowlistedPageFieldMatch } from './field-instruction.ts';
import {
  formulaOperandIsNumber,
  PAGE_FIELD_PLACEHOLDER,
  pageFieldMarker,
  pageFieldText,
  type BodyPageFieldContext,
  type FieldPageContext,
  type PageFieldMarker,
} from './field-page-furniture.ts';

/** A nested page field the tracker may arm for, and whether it waits for document finalize. */
export interface NestedPageArming {
  readonly match: AllowlistedPageFieldMatch;
  readonly deferred: boolean;
}

/**
 * Whether a nested page field the machine matched should arm the tracker. `displayed` is false
 * for a field inside an enclosing instruction: its value feeds that instruction. A formula over
 * a PAGE operand that is not a number (a roman section) keeps its saved result. Furniture with
 * a page context arms live; the body arms deferred; every other story keeps saved results.
 */
export function nestedPageArming(
  match: AllowlistedPageFieldMatch | null,
  displayed: boolean,
  pageContext: FieldPageContext | undefined,
  bodyPageFields: BodyPageFieldContext | false | undefined
): NestedPageArming | null {
  if (!match || !displayed) return null;
  if (pageContext) {
    return formulaOperandIsNumber(match, pageContext.format) ? { match, deferred: false } : null;
  }
  if (!bodyPageFields || !formulaOperandIsNumber(match, bodyPageFields.format)) return null;
  return { match, deferred: true };
}

/** A deferred nested page field: where its saved result sits in the outer field's text. */
export interface DeferredPageSegment {
  readonly at: number;
  readonly length: number;
  readonly marker: PageFieldMarker;
}

/** Longest outer result a deferred segment marker is measured at, as for a body page field. */
const MAX_SEGMENTED_RESULT = 32;

/**
 * The finalize marker for an outer field result that holds deferred nested page fields, or null
 * when the result cannot be measured as one word: whitespace splits it into several spans, and
 * a longer result is not kept whole. The field then shows its saved result.
 */
export function deferredSegmentsMarker(
  text: string,
  segments: readonly DeferredPageSegment[]
): PageFieldMarker | null {
  const first = segments[0];
  if (!first || text.length === 0 || text.length > MAX_SEGMENTED_RESULT || /\s/.test(text)) {
    return null;
  }
  const parts: (string | PageFieldMarker)[] = [];
  let cursor = 0;
  for (const segment of segments) {
    if (segment.at < cursor || segment.at + segment.length > text.length) return null;
    if (segment.at > cursor) parts.push(text.slice(cursor, segment.at));
    parts.push(segment.marker);
    cursor = segment.at + segment.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return { kind: first.marker.kind, segments: parts };
}

/** Most deferred nested page fields one outer result records; later ones keep saved text. */
const MAX_DEFERRED_SEGMENTS = 16;

/**
 * Append the text the tracker returned for a closed nested field to an outer result, and
 * record the deferred marker for it, if any, at the place that text takes.
 */
export function appendNestedPageResult(
  target: { cachedText: string; nestedPageSegments?: DeferredPageSegment[] },
  tracker: NestedPageTracker,
  text: string
): void {
  noteDeferredPage(
    (target.nestedPageSegments ??= []),
    tracker.takeDeferred(),
    target.cachedText,
    text
  );
  target.cachedText += text;
}

/** Record `marker` for `text`, which the caller appends to `before`. */
export function noteDeferredPage(
  segments: DeferredPageSegment[],
  marker: PageFieldMarker | null,
  before: string,
  text: string
): void {
  if (marker && segments.length < MAX_DEFERRED_SEGMENTS) {
    segments.push({ at: before.length, length: text.length, marker });
  }
}

export interface NestedPageTracker {
  /** True while an armed inner live field is skipping its cached digits. */
  readonly active: boolean;
  /**
   * Feed one nested `separate` (the machine's answer plus the nesting level it was seen at,
   * BEFORE any machine advance). Arms when idle and the kind is allowlisted; ignored entirely
   * while armed — a deeper separate belongs to the replaced inner result, and a duplicate
   * separate at the tracked level (null kind) must not clear tracking (the matched end still
   * appends). Callers pass null to decline arming (see {@link nestedPageArming}).
   */
  onSeparate(arming: NestedPageArming | null, level: number): void;
  /**
   * Feed one `end` at `level` (the nesting BEFORE the machine decrements). Returns the live
   * text to append when this end closes the tracked field — possibly `''` when the inner
   * cached result existed but was entirely suppressed (the file said this field's result is
   * not shown, and a live number would resurrect it; fldSimple parity). Returns null when the
   * end is not the tracked one: a deeper end inside the replaced result is ignored and the
   * tracker stays armed; a shallower end (unbalanced input) disarms defensively.
   */
  onEnd(level: number, pageContext: FieldPageContext | undefined): string | null;
  /**
   * The marker of the deferred field the last {@link onEnd} closed, once; null when that field
   * was live, suppressed, or not tracked. Its saved result was the text `onEnd` returned.
   */
  takeDeferred(): PageFieldMarker | null;
  /** Disarm and forget (outer begin, budget abort). */
  reset(): void;
  /**
   * Record one piece of the inner field's cached result, visible or not. `text` is the piece's
   * visible text: a formula with no value on the page (a division by zero) shows it.
   */
  noteResult(visible: boolean, text?: string): void;
}

export function createNestedPageTracker(): NestedPageTracker {
  let field: AllowlistedPageFieldMatch | null = null;
  let deferred = false;
  let lastDeferred: PageFieldMarker | null = null;
  let level = 0;
  let seen = false;
  let visible = false;
  let savedResult = '';
  const reset = (): void => {
    field = null;
    deferred = false;
    level = 0;
    seen = false;
    visible = false;
    savedResult = '';
  };
  return {
    get active(): boolean {
      return field !== null;
    },
    onSeparate(next: NestedPageArming | null, atLevel: number): void {
      if (field !== null) return;
      if (next === null) return;
      field = next.match;
      deferred = next.deferred;
      level = atLevel;
      seen = false;
      visible = false;
      savedResult = '';
    },
    onEnd(atLevel: number, pageContext: FieldPageContext | undefined): string | null {
      if (field === null || atLevel > level) return null;
      const closesTracked = atLevel === level;
      const suppressed = seen && !visible;
      lastDeferred = null;
      if (deferred && closesTracked && !suppressed) {
        // The saved result measures the width; finalize paints each page's value over it.
        const width = savedResult.length > 0 ? savedResult : PAGE_FIELD_PLACEHOLDER;
        lastDeferred = pageFieldMarker(field.kind, field, savedResult);
        reset();
        return width;
      }
      const value =
        closesTracked && pageContext && !suppressed
          ? (pageFieldText(field, pageContext) ?? savedResult)
          : '';
      reset();
      return closesTracked ? value : null;
    },
    takeDeferred(): PageFieldMarker | null {
      const marker = lastDeferred;
      lastDeferred = null;
      return marker;
    },
    reset,
    noteResult(wasVisible: boolean, text = ''): void {
      seen = true;
      if (!wasVisible) return;
      visible = true;
      // Unbounded like the outer field's saved text, which the paragraph scan budget bounds.
      savedResult += text;
    },
  };
}

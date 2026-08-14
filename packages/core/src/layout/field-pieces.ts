// The unit layout measures: one run of text with everything paint will need to draw it.
//
// A "piece" is what the paragraph walk emits and `paragraph-flow.ts` breaks into lines. It is
// deliberately not a run: one run can produce several pieces (a tab splits it), and several runs
// can produce one (a field's cached result). What every piece does carry is its MODEL RANGE, so
// selection, the caret and hit-testing address the store rather than the DOM.
//
// Split out of `field-projection.ts` because these are the vocabulary, not the walk — and that
// module is against the file-size cap.

import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlProperty } from '@docx-editor.dev/core/store';
import type { HardBreakKind } from '@docx-editor.dev/core/store';
import type { InlineDrawingLayoutInput } from './drawing-layout.ts';
import type { RevisionAttribution } from './revision-projection.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import type { SpanLinkRecord } from './semantic-records.ts';

/**
 * A `w:ptab` — the ABSOLUTE-position tab (ECMA-376 §17.3.3.16), which is what a table of
 * contents line is actually made of.
 *
 * Not a `w:tab`: it carries its own destination and leader instead of advancing to the next
 * stop in `w:tabs`, so a paragraph needs no tab stops at all to lay one out. A document that
 * uses these has no `w:tabs` to find, which is why an engine that only models `w:tab` shows
 * the entries and page numbers run together with no dots between them.
 */
export interface PositionalTab {
  readonly alignment: 'left' | 'center' | 'right';
  readonly relativeTo: 'margin' | 'indent' | 'leftMargin';
  readonly leader?: 'dot' | 'hyphen' | 'underscore' | 'middleDot';
}

/**
 * What a piece says about the FIELD result it came from, for Word's shading.
 *
 * Carried from layout rather than decided at paint time because only the walk knows an atom was
 * a field at all — by paint the result is just text. Whether the shading is actually drawn is a
 * view decision made downstream, so this states the fact and nothing about the appearance.
 */
export interface FieldAtomMarker {
  /**
   * A legacy form field: `w:fldChar/w:ffData` (FORMTEXT, FORMCHECKBOX, FORMDROPDOWN).
   *
   * Word shades these on a different rule from ordinary fields — always, unless the document
   * turns it off — because they mark the blanks somebody is meant to fill in.
   */
  readonly formField: boolean;
}

/**
 * One measurable piece produced while walking runs (including projected field results).
 *
 * Projected page-field text covers the single atomic model unit for a well-formed field
 * (`start`..`end` is length 1, matching `paragraphTextOf`). Empty-result allowlisted fields
 * still occupy that unit. Furniture is read-only / non-selectable at the surface; the range
 * stays canonical-aligned for layout consumers.
 */
export interface FieldAwarePiece {
  readonly text: string;
  readonly props: readonly OoxmlProperty[];
  readonly style: ResolvedRunStyle;
  /** UTF-16 model offset range; projected fields cover suppressed cached-result text when present. */
  readonly start: number;
  readonly end: number;
  /** True when text substitutes for a model unit (page field or inert atomic cache). */
  readonly projected?: boolean;
  /**
   * Set when this piece is a `w:ptab`. Its range is ZERO-WIDTH: the element is generic in
   * the canonical tree and contributes nothing to the paragraph's text, so it must advance
   * the line without moving a single model offset — anything else and every offset after it
   * would disagree with the store.
   */
  readonly positionalTab?: PositionalTab;
  /** Typed hard-break intent; model text remains one newline-compatible UTF-16 unit. */
  readonly breakKind?: HardBreakKind;
  /** The hyperlink this piece came from, already sanitized, or absent for ordinary text. */
  readonly link?: SpanLinkRecord;
  /**
   * When set, layout measures this string instead of `text` (eachPage note-mark width
   * reservation). Paint still uses `text`.
   */
  readonly measureText?: string;
  /** Note citation / mark navigation for paint (body ↔ note). */
  readonly noteNav?: {
    readonly scopeId: string;
    readonly direction: 'to-note' | 'to-body';
  };
  /** Typed inline drawing occupying one UTF-16 model unit. */
  readonly inlineDrawing?: InlineDrawingLayoutInput;
  /**
   * The revision wrappers enclosing this text, outermost first, absent when untracked.
   *
   * A stack rather than a single value because revisions nest: an insertion by one author
   * inside a deletion by another is ordinary in a two-round review, and both matter — the
   * outer one decides whether the content exists, the inner one is still someone's pending
   * decision about it.
   */
  readonly revisions?: readonly RevisionAttribution[];
  /** Present when this piece is a field's displayed result; literal or projected. */
  readonly fieldAtom?: FieldAtomMarker;
}

/** A half-open model-offset range, in the paragraph's own UTF-16 offset space. */
export interface ModelRange {
  readonly start: number;
  readonly end: number;
}

export type MutableModelRange = { start: number; end: number };

/** Append a range, coalescing with the previous one when they touch or overlap. */
export function appendModelRange(ranges: MutableModelRange[], start: number, end: number): void {
  if (end <= start) return;
  const last = ranges[ranges.length - 1];
  if (last && last.end >= start) {
    last.end = Math.max(last.end, end);
    return;
  }
  ranges.push({ start, end });
}

const PTAB_ALIGNMENTS = new Set(['left', 'center', 'right']);
const PTAB_RELATIVE_TO = new Set(['margin', 'indent', 'leftMargin']);
const PTAB_LEADERS = new Set(['dot', 'hyphen', 'underscore', 'middleDot']);

/**
 * Read a `w:ptab` off a run child, or null when it is not one.
 *
 * The element is generic in the canonical tree (nothing models it), so this reads its
 * attributes directly and validates every one against its closed enumeration — the values
 * come from the file and go on to drive geometry. `w:leader="none"`, and anything
 * unrecognised, resolves to no leader rather than rejecting the tab: the ADVANCE is still
 * authored, and dropping it would run the text together.
 */
export function positionalTabOf(node: OoxmlNode): PositionalTab | null {
  if (node.kind === 'textValue' || node.localName !== 'ptab') return null;
  if (node.namespaceUri !== WML_NAMESPACE_URI) return null;
  let alignment = 'left';
  let relativeTo = 'margin';
  let leader: string | undefined;
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (attribute.localName === 'alignment') alignment = attribute.value;
    else if (attribute.localName === 'relativeTo') relativeTo = attribute.value;
    else if (attribute.localName === 'leader') leader = attribute.value;
  }
  return {
    alignment: (PTAB_ALIGNMENTS.has(alignment) ? alignment : 'left') as PositionalTab['alignment'],
    relativeTo: (PTAB_RELATIVE_TO.has(relativeTo)
      ? relativeTo
      : 'margin') as PositionalTab['relativeTo'],
    ...(leader !== undefined && PTAB_LEADERS.has(leader)
      ? { leader: leader as NonNullable<PositionalTab['leader']> }
      : {}),
  };
}

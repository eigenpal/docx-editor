// Indent steps: Increase/Decrease Indent and Tab over a selection (paginated-surface seam).
//
// Outside a list, Tab normally types a tab character, and a typed character replaces the
// selection. A selection over paragraphs, or from a paragraph start, is different: Tab
// indents and keeps the text, and Shift+Tab reverses it. Without that rule, selecting a
// paragraph and pressing Tab deleted it.

import { readTwipsMeasure, type OoxmlPart } from '@docx-editor.dev/core/store';
import type { SemanticLayout, SemanticPosition } from '@docx-editor.dev/core/layout';
import { lineSegmentFor, logicalLineSegments } from '../layout/line-segments.ts';
import { paragraphLinesIndex } from '../layout/paragraph-lines.ts';
import { MAX_PARAGRAPH_INDENT_TWIPS } from '../layout/paragraph-indent.ts';
import { paragraphIsRtl } from '../layout/rtl-paragraph.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { paragraphIndentOf, paragraphPropertiesOf, signedFirstLine } from './surface-formatting.ts';
import { firstEditableNoteOffset } from './surface-note-ops.ts';

/** Word's Increase/Decrease Indent step: one default tab stop. */
export const INDENT_STEP_TWIPS = 720;

/**
 * One indent step from `current`, never past the margin or the layout's indent bound. An
 * increase never moves the other way: an authored value past the bound stays put rather
 * than jumping back to the bound. A decrease stops at the margin, as it always has.
 */
export function nextLeftIndent(current: number, step: number, size = INDENT_STEP_TWIPS): number {
  const next = current + step * size;
  return step > 0
    ? Math.max(current, Math.min(MAX_PARAGRAPH_INDENT_TWIPS, next))
    : Math.max(0, next);
}

/**
 * `w:ind/@left` in twips, zero when nothing states it.
 *
 * Resolved across the whole list rather than picked out of it: this reads a CASCADE, whose
 * entries run lowest precedence first, so taking the first `w:ind` answered the style's
 * indent for a paragraph that had already been indented past it — and Increase Indent then
 * rewrote the same one step forever.
 *
 * Resolved PER LEVEL, not per attribute, which is where `cascadedParagraphAttributes` is
 * the wrong tool: `w:left` and `w:start` are two SPELLINGS OF ONE SETTING (transitional and
 * ISO Strict), so flattening both into one bag and preferring `left` answers whichever
 * level happened to use that word. A paragraph spelling it `w:start` over a style spelling
 * it `w:left` then stepped BACKWARDS on Increase Indent. This is the rule `paragraphIndent`
 * already applies, and the two must agree or the ruler and the button disagree.
 */
export function leftIndentTwipsOf(
  properties: readonly { localName: string; attributes?: Readonly<Record<string, string>> }[]
): number {
  let raw: string | undefined;
  for (const property of properties) {
    if (property.localName !== 'ind') continue;
    const stated = property.attributes?.left ?? property.attributes?.start;
    if (stated !== undefined) raw = stated;
  }
  const twips = readTwipsMeasure(raw);
  return twips === null || Math.abs(twips) > 9_999_999 ? 0 : twips;
}

/** The indent Tab or Shift+Tab writes over a selection, and the paragraphs it covers. */
export interface TabIndent {
  readonly write: 'stepLeft' | 'setFirstLine' | 'clearFirstLine';
  readonly paragraphs: readonly string[];
}

/** What {@link tabIndentFor} reads about one paragraph. */
export interface TabIndentReads {
  /** The first offset the paragraph paints. Hidden leading content is not a start. */
  paragraphStart(paragraphId: string): number;
  /** Whether the paragraph paints no content at all, so its start is also its end. */
  paintsNothing(paragraphId: string): boolean;
  /**
   * Resolved indent in twips. `start` is the logical leading side, `w:left` or `w:start`,
   * also in a right-to-left paragraph. `firstLine` is signed, negative when hanging.
   */
  indent(paragraphId: string): { readonly start: number; readonly firstLine: number };
}

/**
 * What Tab (`increase`) or Shift+Tab (`decrease`) does over a selection outside a list, or
 * `null` when the keymap keeps its plain behavior: Tab types a tab character, Shift+Tab
 * steps the left indent of every touched paragraph.
 *
 * - A selection over two or more paragraphs steps the left indent of all of them.
 * - A selection in one paragraph that starts at the paragraph start, whole or partial,
 *   works on the first line. Tab sets a first-line indent of one `step`, the document's
 *   default tab stop. When the first line already has one step or more, or a hanging
 *   indent, Tab steps the left indent instead.
 *   Shift+Tab reverses that: it steps the left indent back first, then clears the
 *   first-line indent.
 * - A caret, or a selection in one paragraph that starts inside the text, answers `null`.
 *
 * `touched` is every paragraph from the range start to the range end, in order. A range
 * that ends at the start of the next paragraph (its first painted offset or before) selects
 * only the paragraph mark, so that last paragraph does not count. The other paragraph
 * commands keep that paragraph, as they always have.
 */
export function tabIndentFor(
  range: { readonly from: SemanticPosition; readonly to: SemanticPosition },
  touched: readonly string[],
  reads: TabIndentReads,
  direction: 'increase' | 'decrease',
  step: number
): TabIndent | null {
  const { from, to } = range;
  if (from.paragraphId === to.paragraphId && from.offset === to.offset) return null;
  // An empty last paragraph is selected whole by a range that reaches it.
  const markOnly =
    touched.length > 1 &&
    !reads.paintsNothing(to.paragraphId) &&
    to.offset <= reads.paragraphStart(to.paragraphId);
  const paragraphs = markOnly ? touched.slice(0, -1) : touched;
  if (paragraphs.length > 1) return { write: 'stepLeft', paragraphs };
  if (from.offset > reads.paragraphStart(from.paragraphId)) return null;
  const { start, firstLine } = reads.indent(from.paragraphId);
  if (direction === 'increase') {
    const opensFirstLine = firstLine >= 0 && firstLine < step;
    return { write: opensFirstLine ? 'setFirstLine' : 'stepLeft', paragraphs };
  }
  return { write: start <= 0 && firstLine > 0 ? 'clearFirstLine' : 'stepLeft', paragraphs };
}

/**
 * The first offset a paragraph paints, `null` when it paints nothing, or -1 when it has no
 * paragraph start of its own.
 *
 * A paragraph can open with content that takes no caret stop: a hidden run, a field
 * instruction, or deleted text the current view hides. A selection from the first visible
 * character still starts at the paragraph start. A paragraph whose first line opens with
 * another paragraph's text (after a style separator, or a deleted paragraph mark in a
 * resolved view) starts in the middle of that line, so no offset in it is a start.
 */
export function firstPaintedOffset(layout: SemanticLayout, paragraphId: string): number | null {
  let first = Number.POSITIVE_INFINITY;
  let checkedFirstLine = false;
  for (const { line } of paragraphLinesIndex(layout).get(paragraphId) ?? []) {
    if (!checkedFirstLine) {
      checkedFirstLine = true;
      // Logical order: a right-to-left line draws its first paragraph on the right.
      if (logicalLineSegments(line)[0]?.paragraphId !== paragraphId) return -1;
    }
    const segment = lineSegmentFor(line, paragraphId);
    if (!segment) continue;
    for (const span of segment.spans) {
      if (span.range.end > span.range.start) first = Math.min(first, span.range.start);
    }
    for (const drawing of segment.drawings) first = Math.min(first, drawing.start);
    // Later lines hold later offsets; the first line that paints anything decides.
    if (Number.isFinite(first)) break;
  }
  return Number.isFinite(first) ? first : null;
}

/** {@link TabIndentReads} over a published layout and the story part that holds the paragraphs. */
export function layoutTabIndentReads(layout: SemanticLayout, part: OoxmlPart): TabIndentReads {
  return {
    paintsNothing: (paragraphId) => firstPaintedOffset(layout, paragraphId) === null,
    paragraphStart(paragraphId) {
      const painted = firstPaintedOffset(layout, paragraphId) ?? 0;
      if (painted < 0) return painted;
      // A note paragraph starts after its reference mark, which is not note text.
      const node = findNode(part, paragraphId);
      return Math.max(painted, node?.kind === 'paragraph' ? firstEditableNoteOffset(node) : 0);
    },
    indent(paragraphId) {
      const entry = paragraphIndentOf(layout, paragraphId);
      if (!entry) return { start: 0, firstLine: 0 };
      // Layout sides are physical; the leading side of a right-to-left paragraph is its right.
      const rtl = paragraphIsRtl(paragraphPropertiesOf(layout, paragraphId));
      const start = rtl ? entry.indent.right : entry.indent.left;
      return { start: Math.round(start * 20), firstLine: signedFirstLine(entry.indent) };
    },
  };
}

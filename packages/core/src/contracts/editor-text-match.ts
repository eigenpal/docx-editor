// One `findMatches` result. Split from `editor.ts`, which re-exports it.

import type { ViewScope } from './editor-scope.ts';

/**
 * One occurrence of a search query in the document.
 *
 * Carries TWO addresses on purpose. `blockId` + `start` is the engine's own: stable
 * across edits and independent of ordering. `paragraphIndex` + `runIndex` + `runOffset`
 * is the positional one a find/replace UI needs to show and navigate results, and it is
 * derived from the same walk rather than left to the caller to reconstruct — a caller
 * guessing at run boundaries would send the selection to the wrong place.
 *
 * A match can span runs when formatting changes mid-word; the run address is where it
 * STARTS. `scope` identifies a non-body story so navigation opens the correct surface.
 * A frame scope selects its anchoring drawing and never places a caret inside its story.
 * A match inside a field result reports the field atom's model range. Its `length` is one,
 * while `text` carries the visible match and can be longer. Select with `start` and `length`.
 * Never derive the selected length from `text.length`.
 */
export interface TextMatch {
  readonly blockId: string;
  /** Character offset within the paragraph's concatenated run text. */
  readonly start: number;
  readonly length: number;
  /**
   * Paragraph ordinal within this match's story. Table and nested-table paragraphs count.
   * Non-paragraph blocks add no ordinal.
   */
  readonly paragraphIndex: number;
  /** Index of the run the match starts in, and the offset within that run. */
  readonly runIndex: number;
  readonly runOffset: number;
  /** Story containing the match. Absence means the body. */
  readonly scope?: ViewScope;
  /** The matched text as it appears in the document. */
  readonly text: string;
  /**
   * Paragraph text immediately before and after the match, bounded at the derivation
   * boundary. A results list shows the match in its sentence — "…as described in this
   * **Exhi**bit A" — and nothing else in the contract can reach paragraph text, so a
   * caller would otherwise have to re-read the document to render one row.
   *
   * Optional and additive: an implementation that has not derived them omits them, and a
   * consumer treats absent as empty.
   */
  readonly contextBefore?: string;
  readonly contextAfter?: string;
}

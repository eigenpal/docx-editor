// The run properties of a paragraph MARK: the paragraph's run cascade with the mark's own
// `w:pPr/w:rPr` on top.
//
// That `w:rPr` can name a character style in `w:rStyle`, and the style joins the mark's
// cascade at the character level, the same as it does for a content run: its `basedOn`
// chain is one level between the paragraph-level properties and the mark's direct
// properties, and its toggles combine by §17.7.3. The direct properties are absolute.
//
// Measured in anonymous probes, with a named style and the same values as direct `w:rPr`:
//
//   empty paragraph        the line is sized by the style, the same as by a direct size
//   footer empty mark      a 10pt style under a 12pt paragraph style gives the 10pt line
//   numbering marker       the style's size, colour and bold; `basedOn` inherits; a bold
//                          paragraph style with a bold mark style gives a regular marker
//   missing / wrong type   a missing id or a paragraph style id changes nothing
//   empty table cell       the end paragraph's line is sized by the style
//   break at the end       the empty last line after a trailing `w:br` is sized by the style
//   typing                 the first text typed into an empty paragraph takes the style,
//                          and the toolbar shows that face first (`mark-character-style-run.ts`)
//
// ONE PLACE IS DELIBERATELY LEFT OUT: sizing a line that has content in it. A 12pt text line
// with a 24pt mark does not grow in the reference, by direct size or by style, in body text or
// in a table cell, and a line holding only an inline picture does not either. Layout already
// grows such lines for a DIRECT mark (the last-line mark height, the fallback band of a
// drawing-only line and the line-start estimate in `paragraph-flow.ts`, the end-mark floor in
// `table-cell-end-mark.ts`), and that rule has its own fixtures. Letting the style reach them
// would add the same growth for every styled mark, so those readers take the mark WITHOUT its
// character style from {@link markRunPropertiesWithoutCharacterStyle}.

import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import { styleChain, styleIdFromProps } from './style-chain.ts';
import { combineStyleToggles } from './style-toggles.ts';

/**
 * The mark as it resolved before its character style joined, against the mark it came from.
 *
 * A side channel, for the reason `style-toggles.ts` gives for its own: the mark's list travels
 * by identity through the public `ParagraphLayoutInputs`, the prepass entry and the line
 * breaker's flow options, and a second public field would be one nobody outside layout reads.
 * Only a mark that names a character style with properties has an entry.
 */
const unstyledMarks = new WeakMap<readonly OoxmlProperty[], readonly OoxmlProperty[]>();

/**
 * Resolve a paragraph mark from the paragraph's run cascade and the mark's direct `w:rPr`.
 *
 * `runProperties` must be the array the paragraph cascade built, because the toggle state it
 * carries is adopted, not re-read. `finish` applies the document's compatibility overrides to
 * each list this returns, so the list the caller receives is the one the side channel knows.
 *
 * A mark with no `w:rPr` returns `finish(runProperties)`. Keep that identity: a consumer tells
 * "the mark states nothing" from "the mark states something" by comparing the two arrays.
 * A mark with `w:rPr` but no `w:rStyle` does NOT pick up the default character style.
 */
export function paragraphMarkRunProperties(
  table: StyleCascadeTable,
  runProperties: readonly OoxmlProperty[],
  markProperties: readonly OoxmlProperty[],
  finish: (properties: readonly OoxmlProperty[]) => readonly OoxmlProperty[]
): readonly OoxmlProperty[] {
  if (markProperties.length === 0) return finish(runProperties);
  // Combined rather than concatenated so the result carries its resolved toggle state like
  // any other cascade output. `list-resolve.ts` resolves a numbering marker from this list,
  // and a plain concatenation would leave the marker reading the bare properties.
  const unstyled = finish(
    combineStyleToggles([
      { properties: runProperties, role: 'carried', emit: true },
      { properties: markProperties, role: 'direct', emit: true },
    ])
  );
  const styleId = styleIdFromProps(markProperties, 'rStyle');
  const characterProperties = styleId
    ? styleChain(table, styleId, 'character').flatMap((style) => style.runProperties)
    : [];
  if (characterProperties.length === 0) return unstyled;
  const styled = finish(
    combineStyleToggles([
      { properties: runProperties, role: 'carried', emit: true },
      { properties: characterProperties, role: 'xor', emit: true },
      { properties: markProperties, role: 'direct', emit: true },
    ])
  );
  unstyledMarks.set(styled, unstyled);
  return styled;
}

/**
 * The mark without its character style, for the readers that grow a line with content in it.
 *
 * Returns `mark` itself when it names no character style, or when it did not come from
 * {@link paragraphMarkRunProperties}, so the identity comparisons of those readers still hold.
 */
export function markRunPropertiesWithoutCharacterStyle(
  mark: readonly OoxmlProperty[]
): readonly OoxmlProperty[] {
  return unstyledMarks.get(mark) ?? mark;
}

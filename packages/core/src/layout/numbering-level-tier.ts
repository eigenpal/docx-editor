// Where a numbering level's `w:pPr` ranks among a list paragraph's own formatting.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { propertiesOf } from './paragraph-flow.ts';
import { paragraphStyleChain } from './style-chain.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import { isElement, type StyleDefinition } from './style-definition-reader.ts';

/** Whether this `w:pPr` states a `w:numPr`, whatever the `w:numPr` holds. */
function statesNumPr(pPr: OoxmlNode | undefined): boolean {
  return (
    pPr !== undefined &&
    isElement(pPr) &&
    pPr.children.some((child) => isElement(child) && child.localName === 'numPr')
  );
}

/**
 * How many styles of the base-first `chain` rank BELOW the numbering level.
 *
 * The level sits directly below the nearest `w:pPr` that states a `w:numPr`, whether that
 * `w:numPr` names the `w:numId`, only a `w:ilvl`, or both. A paragraph with its own
 * `w:numPr` puts the level above the whole chain. Otherwise the nearest style stating one
 * and the styles based on it outrank the level, and its bases do not. This holds for every
 * property of the level's `w:pPr`: indents, spacing, alignment and tabs alike. A base style
 * with a first-line indent, left alignment or a cleared tab stop leaves the level's values
 * in place, and a value the style that states the `w:numPr` gives itself replaces the
 * level's. A child style that states only `w:ilvl` therefore ranks its base's indent below
 * the level it picks.
 */
export function numberingLevelRank(
  chain: readonly StyleDefinition[],
  directPPr: OoxmlNode | undefined
): number {
  if (statesNumPr(directPPr)) return chain.length;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (statesNumPr(chain[index]!.paragraphPropertiesNode)) return index;
  }
  return 0;
}

/** The `w:val` of the `w:numId` this `w:pPr` states, or `undefined` when it states none. */
function statedNumId(pPr: OoxmlNode | undefined): string | undefined {
  if (pPr === undefined || !isElement(pPr)) return undefined;
  const numPr = pPr.children.find((child) => isElement(child) && child.localName === 'numPr');
  if (numPr === undefined || !isElement(numPr)) return undefined;
  const numId = numPr.children.find((child) => isElement(child) && child.localName === 'numId');
  if (numId === undefined || !isElement(numId)) return undefined;
  return numId.attributes.find((attribute) => attribute.localName === 'val')?.value ?? '';
}

/**
 * How many styles of the base-first `chain` rank below a numbering removal, or `null` when
 * the paragraph's numbering is not removed.
 *
 * The nearest `w:pPr` that states a `w:numId` decides, as it does for list membership. When
 * it states `w:val="0"` (§17.9.18, no numbering), the removal ranks directly below THAT
 * `w:pPr`: above the whole chain when it is the paragraph's own. A level-only `w:numPr`
 * above it does not move the removal, unlike a level.
 *
 * ECMA-376 Part 1 §17.9.18 (`numId`): "A value of 0 for the val attribute shall never be
 * used to point to a numbering definition instance, and shall instead only be used to
 * designate the removal of numbering properties at a particular level in the style
 * hierarchy (typically via direct formatting)."
 */
function numberingRemovalRank(
  chain: readonly StyleDefinition[],
  directPPr: OoxmlNode | undefined
): number | null {
  const direct = statedNumId(directPPr);
  if (direct !== undefined) return direct === '0' ? chain.length : null;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const stated = statedNumId(chain[index]!.paragraphPropertiesNode);
    if (stated !== undefined) return stated === '0' ? index : null;
  }
  return null;
}

/**
 * What a numbering removal states at its rank: no leading indent and no first-line offset,
 * in twips and in character units. The trailing indent is not part of it. Only the flat
 * property list carries this tier; `paragraphPropertyNodes` has no node for it.
 */
const REMOVED_NUMBERING_PROPERTIES: readonly OoxmlProperty[] = Object.freeze([
  Object.freeze({
    localName: 'ind',
    attributes: Object.freeze({
      left: '0',
      leftChars: '0',
      firstLine: '0',
      firstLineChars: '0',
      hangingChars: '0',
    }),
  }),
]);

/**
 * The properties a paragraph's numbering contributes to its cascade, and how many styles of
 * the base-first `chain` rank below them.
 *
 * A resolved level contributes its own `w:pPr` (`levelPPr`) at `numberingLevelRank`. A
 * paragraph whose numbering is removed with `w:numId w:val="0"` has no level, but the
 * removal resets the leading indent and the first-line offset of every tier below it. So a
 * direct `w:numId w:val="0"` puts the paragraph at the margin even when its style indents
 * it, and a style stating `w:numId w:val="0"` cancels its bases' indents but keeps its own.
 * A `w:ind` the paragraph states still applies, and the trailing indent is unchanged.
 *
 * §17.9.18 states only that the removal takes away numbering properties. Resetting the
 * leading and first-line indents that a paragraph style supplies goes beyond that text: it
 * is a layout rule. §17.3.1.12 (`ind`) defines the `left`/`start`, `firstLine`, and
 * `hanging` values and their character-unit forms that this tier resets.
 */
export function numberingTier(
  chain: readonly StyleDefinition[],
  directPPr: OoxmlNode | undefined,
  levelPPr: OoxmlElement | undefined
): { readonly rank: number; readonly properties: readonly OoxmlProperty[] } {
  if (levelPPr) {
    return { rank: numberingLevelRank(chain, directPPr), properties: propertiesOf(levelPPr) };
  }
  const removal = numberingRemovalRank(chain, directPPr);
  return removal === null
    ? { rank: chain.length, properties: [] }
    : { rank: removal, properties: REMOVED_NUMBERING_PROPERTIES };
}

/**
 * A list paragraph's inherited properties split around its numbering level at
 * `numberingLevelRank`: `below` is what the level outranks and `above` is what outranks it.
 * Concatenated, the two are the cascade order.
 */
export function numberingLevelTiers(
  table: StyleCascadeTable,
  styleId: string | null,
  directPPr: OoxmlNode | undefined
): { readonly below: readonly OoxmlProperty[]; readonly above: readonly OoxmlProperty[] } {
  const chain = paragraphStyleChain(table, styleId);
  const rank = numberingLevelRank(chain, directPPr);
  return {
    below: [
      ...table.docDefaultsParagraph,
      ...chain.slice(0, rank).flatMap((style) => style.paragraphProperties),
    ],
    above: [
      ...chain.slice(rank).flatMap((style) => style.paragraphProperties),
      ...propertiesOf(directPPr),
    ],
  };
}

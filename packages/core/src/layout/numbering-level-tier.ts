// Where a numbering level's `w:pPr/w:ind` ranks among a list paragraph's own formatting.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import { propertiesOf } from './paragraph-flow.ts';
import { styleChain } from './style-chain.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import { isElement, type StyleDefinition } from './style-definition-reader.ts';

/** Whether this `w:pPr` names a numbering instance itself: its `w:numPr` states `w:numId`. */
function statesNumId(pPr: OoxmlNode | undefined): boolean {
  if (!pPr || !isElement(pPr)) return false;
  const numPr = pPr.children.find(
    (child): child is OoxmlElement => isElement(child) && child.localName === 'numPr'
  );
  return numPr?.children.some((child) => isElement(child) && child.localName === 'numId') === true;
}

/**
 * Whether the paragraph applies its numbering directly, which is decided by `w:numId`.
 *
 * A direct `w:numPr` that states only `w:ilvl` picks a level of the numbering the style
 * supplies; the numbering still comes from the style.
 */
export function appliesNumberingDirectly(directPPr: OoxmlNode | undefined): boolean {
  return statesNumId(directPPr);
}

/**
 * How many styles of the base-first `chain` rank BELOW the numbering level.
 *
 * Directly applied numbering outranks the whole chain. Numbering a style supplies sits
 * directly below the style that declares it (the nearest one stating `w:numId`, the same
 * style `readNumPr` takes the id from): that style and the styles based on it outrank the
 * level, and its own bases do not. A body style with a first-line indent under a numbered
 * heading style therefore keeps the level's hanging indent, while an indent the numbered
 * style states itself replaces the level's.
 */
function levelRank(chain: readonly StyleDefinition[], directPPr: OoxmlNode | undefined): number {
  if (appliesNumberingDirectly(directPPr)) return chain.length;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (statesNumId(chain[index]!.paragraphPropertiesNode)) return index;
  }
  return 0;
}

/**
 * A list paragraph's inherited properties split around its numbering level: `below` is what
 * the level outranks (document defaults, then the declaring style's bases) and `above` is
 * what outranks it (the declaring style, the styles based on it, then the paragraph's own
 * `w:pPr`). Concatenated, the two are the cascade order.
 */
export function numberingLevelTiers(
  table: StyleCascadeTable,
  styleId: string | null,
  directPPr: OoxmlNode | undefined
): { readonly below: readonly OoxmlProperty[]; readonly above: readonly OoxmlProperty[] } {
  const chain = styleId ? styleChain(table, styleId, 'paragraph') : [];
  const rank = levelRank(chain, directPPr);
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

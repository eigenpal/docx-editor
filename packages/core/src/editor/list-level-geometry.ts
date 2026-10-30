// Where each level of a list puts its marker and text, read the way layout paints it.
//
// Switching a list item between bullets and numbers mints a definition for the other kind.
// Its levels must sit where the item's old list put them, or the item jumps sideways.

import type {
  ListDefinitionGeometry,
  ListLevelGeometry,
  OoxmlElement,
} from '@docx-editor.dev/core/store';
import { resolveNumberingLevel, type NumberingIndex } from '../layout/numbering-index.ts';
import { numberingLevelRank } from '../layout/numbering-level-tier.ts';
import { numberingParagraphProperties } from '../layout/numbering-paragraph-properties.ts';
import { cascadeParagraphFormatting, type StyleCascadeTable } from '../layout/style-cascade.ts';
import { styleChain } from '../layout/style-chain.ts';

const LEVEL_COUNT = 9;

const twips = (points: number): number => Math.round(points * 20);

/** One signed first-line slot: a hanging indent wins, and a negative first line is one. */
function firstLineOffset(hanging: number, firstLine: number): ListLevelGeometry {
  return hanging > 0 || firstLine < 0
    ? { hanging: twips(hanging > 0 ? hanging : -firstLine) }
    : { firstLine: twips(firstLine) };
}

/**
 * The nine levels of `numId`, as the indent, suffix, marker alignment and level paragraph
 * properties they resolve to after `w:lvlOverride` and `w:numStyleLink`.
 *
 * Only what a level states is carried, so a level that leaves `w:hanging` to the style does
 * not gain one, and every item keeps the indent its level and its own formatting give it.
 * A level the list does not declare is left to the stock geometry. `index` must already
 * have its style links resolved, as layout's own index does.
 */
export function listDefinitionGeometry(
  index: NumberingIndex,
  numId: string
): ListDefinitionGeometry {
  return Array.from({ length: LEVEL_COUNT }, (_, ilvl): ListLevelGeometry | undefined => {
    const level = resolveNumberingLevel(index, numId, ilvl)?.level;
    if (!level) return undefined;
    const paragraphProperties = numberingParagraphProperties(level);
    const { indent } = level;
    const stated = indent.stated;
    return {
      ...(stated?.left ? { left: twips(indent.left) } : {}),
      ...(stated?.right ? { right: twips(indent.right) } : {}),
      ...(stated?.firstLineOffset ? firstLineOffset(indent.hanging, indent.firstLine) : {}),
      suffix: level.suff,
      align: level.lvlJc,
      ...(paragraphProperties ? { paragraphProperties } : {}),
    };
  });
}

/** Which sides of an indent a property list states: leading, trailing, first-line offset. */
export interface IndentSides {
  readonly left: boolean;
  readonly right: boolean;
  readonly offset: boolean;
}

/** The sides the `w:ind` entries in `properties` state. */
export function indentSidesOf(
  properties: readonly { localName: string; attributes?: Readonly<Record<string, string>> }[]
): IndentSides {
  const states = (...names: string[]) =>
    properties.some(
      (property) =>
        property.localName === 'ind' &&
        names.some((name) => property.attributes?.[name] !== undefined)
    );
  return {
    left: states('left', 'start'),
    right: states('right', 'end'),
    offset: states('hanging', 'firstLine'),
  };
}

/**
 * The indent sides a paragraph's numbering STYLE states over its level, or null when the
 * paragraph names its list itself.
 *
 * A style that carries the `w:numPr` ranks itself (and the styles based on it) above the
 * level; a paragraph that names the list directly ranks the level above every style. The
 * switch writes `w:numPr` on the paragraph, so these sides lose to the level afterwards.
 */
export function styleNumberedIndentSides(
  table: StyleCascadeTable | undefined,
  paragraph: OoxmlElement
): IndentSides | null {
  if (!table) return null;
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  const styleId = cascadeParagraphFormatting(table, pPr).styleId;
  const chain = styleId ? styleChain(table, styleId, 'paragraph') : [];
  const rank = numberingLevelRank(chain, pPr);
  if (rank >= chain.length) return null;
  return indentSidesOf(chain.slice(rank).flatMap((style) => style.paragraphProperties));
}

/**
 * The surface structure lane's two list reads, over the numbering index layout resolves
 * against. `index` is read per call, so a definition minted since is seen.
 */
export function listDefinitionReads(index: () => NumberingIndex) {
  return {
    listGeometryOf: (numId: string) => listDefinitionGeometry(index(), numId),
    listLevelKindOf: (numId: string, level: number) => listLevelKind(index(), numId, level),
  };
}

/** Which kind of marker `numId` draws at `level`, or null when it does not resolve. */
export function listLevelKind(
  index: NumberingIndex,
  numId: string,
  level: number
): 'bullet' | 'ordered' | null {
  const resolved = resolveNumberingLevel(index, numId, level)?.level;
  if (!resolved) return null;
  return resolved.numFmt === 'bullet' ? 'bullet' : 'ordered';
}

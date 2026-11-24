import { APPLICATION_PARAGRAPH_PROPERTIES } from '../store/package/application-doc-defaults.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

/** Deepest `w:basedOn` chain this check follows; style cycles stop earlier. */
const MAX_STYLE_CHAIN = 32;

const SPACE_AFTER_ATTRIBUTES = new Set(['after', 'afterLines', 'afterAutospacing']);

/** One `w:pPr` child, either as a parsed element or as a flattened cascade property. */
type ParagraphProperty =
  | { readonly localName: string; readonly attributes: readonly { readonly localName: string }[] }
  | { readonly localName: string; readonly attributes?: Readonly<Record<string, string>> };

function statesSpaceAfter(property: ParagraphProperty): boolean {
  if (property.localName !== 'spacing' || !property.attributes) return false;
  const names = Array.isArray(property.attributes)
    ? property.attributes.map((attribute) => attribute.localName)
    : Object.keys(property.attributes);
  return names.some((name) => SPACE_AFTER_ATTRIBUTES.has(name));
}

/**
 * Whether the document itself sets the space after a separator paragraph.
 *
 * A footnote separator mark sits in an ordinary paragraph of the separator note (ECMA-376
 * Part 1, §17.11.23 separator), so Word lays that paragraph out with the full paragraph cascade (§17.7.2): its
 * direct `w:pPr`, its paragraph style or the default paragraph style with their `w:basedOn`
 * chains, and `w:docDefaults`. A `w:spacing/@w:after` from any of those layers (§17.3.1.33)
 * separates the rule from the first note. Word reference renders confirm this: with a Normal
 * style of 12 pt after, the first note starts 12 pt further below the rule.
 *
 * The one value the document does not set is the application default for an omitted
 * `w:pPrDefault` (§17.7.5.3). Only that case returns false, so the separator does not take
 * the application's trailing space.
 */
export function separatorStatesSpaceAfter(
  direct: readonly ParagraphProperty[],
  cascade: StyleCascadeTable | undefined
): boolean {
  if (direct.some(statesSpaceAfter)) return true;
  // A named style is authored geometry even when its chain states no spacing.
  if (direct.some((property) => property.localName === 'pStyle')) return true;
  if (!cascade) return false;
  const seen = new Set<string>();
  let styleId = cascade.defaultParagraphStyleId;
  while (styleId && !seen.has(styleId) && seen.size < MAX_STYLE_CHAIN) {
    seen.add(styleId);
    const style = cascade.styles.get(styleId);
    if (!style) break;
    if (style.paragraphProperties.some(statesSpaceAfter)) return true;
    styleId = style.basedOn;
  }
  // Application defaults lead `docDefaultsParagraph`; the authored `w:pPrDefault` follows.
  return cascade.docDefaultsParagraph.some(
    (property) => !isApplicationDefault(property) && statesSpaceAfter(property)
  );
}

/** The application defaults are shared frozen objects, so identity marks them. */
function isApplicationDefault(property: unknown): boolean {
  return (APPLICATION_PARAGRAPH_PROPERTIES as readonly unknown[]).includes(property);
}

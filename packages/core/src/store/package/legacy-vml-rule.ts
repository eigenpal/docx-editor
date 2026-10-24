// A horizontal rule: a legacy rectangle marked `o:hr`, which spans the text column.
//
// The rule writes no width of its own (`width:0`); layout gives it the width of the line it
// sits on. A standard rule is shaded as a groove: its fill colour above, a light band below.
// A rule with no shading is one solid bar.

import { color, named, OFFICE, off, attribute as a, points, styleOf } from './legacy-vml-values.ts';
import type { OoxmlElement } from './ooxml-tree.ts';

/** The rule a layout widens to its line. */
export interface HorizontalRuleProjection {
  /** `RRGGBB` of the bar, or of its upper band when shaded. */
  readonly fillHex: string;
  /** The lower band is light grey, as a groove. */
  readonly shaded: boolean;
}

/** The light lower band of a shaded rule. */
export const RULE_SHADE_HEX = 'E0E0E0';
const MAX_HEIGHT_POINTS = 100;

/**
 * The rule of a `v:rect` marked `o:hr`, with its height in points; undefined for any other
 * shape, null for a rule outside this subset (a set width or percentage, or a floating one).
 */
export function legacyHorizontalRule(
  root: OoxmlElement
): { readonly rule: HorizontalRuleProjection; readonly heightPt: number } | null | undefined {
  if (!named(root, 'urn:schemas-microsoft-com:vml', 'rect')) return undefined;
  const marked = a(root, 'hr', OFFICE);
  if (marked === undefined || off(marked)) return undefined;
  const style = styleOf(root);
  if (!style || style.get('position') === 'absolute') return null;
  // The full column: no width, and no percentage other than the whole (in tenths of a percent).
  const width = points(style.get('width') ?? '0');
  const percent = a(root, 'hrpct', OFFICE);
  if (width !== 0 || (percent !== undefined && !['0', '1000'].includes(percent.trim())))
    return null;
  const heightPt = points(style.get('height') ?? '1.5pt');
  if (!(heightPt > 0 && heightPt <= MAX_HEIGHT_POINTS)) return null;
  const fill = color(a(root, 'fillcolor'), '#a0a0a0');
  if (!fill) return null;
  return Object.freeze({
    rule: Object.freeze({
      fillHex: fill.slice(1).toUpperCase(),
      shaded: off(a(root, 'hrnoshade', OFFICE) ?? 'f'),
    }),
    heightPt,
  });
}

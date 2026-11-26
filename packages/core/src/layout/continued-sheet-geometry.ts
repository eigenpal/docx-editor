// A section that starts with `w:type="continuous"` (ECMA-376 Part 1, 17.6.22) continues on the
// sheet of the section before it. That sheet keeps the earlier section's bottom margin (17.6.11):
// body text stops above it, and a page- or margin-positioned table (17.4.57) that reaches below
// it breaks there, not at the continued section's own margin.

import type { PageContentInsets } from './page-furniture-insets.ts';

//
// The sheet also keeps the earlier section's side margins as its page margins. A DrawingML
// anchor positioned from the margin (`wp:positionH/@relativeFrom="margin"`, ST_RelFromH,
// 20.4.3.4) measures from them, while the continued section's text, text frames, and tables
// measure from its own `w:pgMar` (`continued-section-origin.ts`).

interface SheetGeometry {
  readonly width: number;
  readonly height: number;
  readonly margin: { readonly left: number; readonly right: number; readonly bottom: number };
}

/** The host sheet's side margins, where they differ from the section's own. */
export interface HostSideMargins {
  readonly hostMargin?: { readonly left: number; readonly right: number };
}

/**
 * `geometry` with the bottom margin and the side margins of the host sheet, whose content
 * insets are `continued`, when the sheet being filled is a continued section's first one;
 * `geometry` otherwise.
 */
export function hostSheetGeometry<T extends SheetGeometry>(
  geometry: T,
  continued: PageContentInsets | undefined
): T & HostSideMargins {
  if (!continued) return geometry;
  const left = continued.left ?? geometry.margin.left;
  const right = continued.right ?? geometry.margin.right;
  const sameSides = left === geometry.margin.left && right === geometry.margin.right;
  if (sameSides && continued.bottom === geometry.margin.bottom) return geometry;
  return {
    ...geometry,
    margin: { ...geometry.margin, bottom: continued.bottom },
    ...(sameSides ? {} : { hostMargin: { left, right } }),
  };
}

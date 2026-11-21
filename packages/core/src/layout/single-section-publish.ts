// Publishing the layout of a single-section body: page fields, content control boundaries,
// and the overflow sheets the notes pass mints from it.

import { carryLayoutReadCaches } from './layout-read-caches.ts';
import { finalizePageFieldProjection, withPageFieldSources } from './field-projection.ts';
import { withContentControlMetadata } from './content-control-boundary-layout.ts';
import { registerOverflowPageShell } from './page-furniture-insets.ts';
import type { BlockLayoutResult } from './column-balance-layout.ts';
import type { SemanticLayoutOptions } from './semantic-layout-options.ts';
import type { SemanticLayout } from './semantic-records.ts';
import type { SectionPageNumbering } from './section-properties.ts';

/** The published layout of `laid`, the one section's pass; records it in the session. */
export function publishSingleSectionLayout(
  laid: BlockLayoutResult,
  numbering: SectionPageNumbering | undefined,
  opts: SemanticLayoutOptions
): SemanticLayout {
  // Carry boundary metadata through field annotation so a no-change resume still early-exits
  // in `attachContentControlBoundaries` instead of allocating a fresh `pages` array.
  const annotated: SemanticLayout = withContentControlMetadata(
    {
      revision: laid.layout.revision,
      pages: withPageFieldSources(
        laid.pages,
        numbering?.start ?? 1,
        laid.pages.length,
        numbering?.fmt
      ),
    },
    laid.layout
  );
  const finalized = finalizePageFieldProjection(annotated, {
    provisional: opts.bodyBlockLimit !== undefined || opts.noteRoundBlockLimit !== undefined,
  });
  carryLayoutReadCaches(laid.layout, finalized);
  // The notes pass mints overflow sheets from this layout; publish what index they land at.
  registerOverflowPageShell(finalized, (_sectionAnchorIndex, documentPageIndex, box, shift) =>
    laid.overflowShellAt(documentPageIndex, box, shift)
  );
  if (opts.session) {
    opts.session.multi = null;
    opts.session.previous = finalized;
  }
  return finalized;
}

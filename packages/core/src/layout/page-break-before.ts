// `w:pageBreakBefore` (ECMA-376 Part 1 §17.3.1.23): where a paragraph opens a page, and whether
// it keeps its space before there.

import type { OoxmlElement, OoxmlProperty } from '@docx-editor.dev/core/store';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import { paragraphBreaksBefore } from './paragraph-style.ts';
import { markIgnoresPageBreakBefore } from './section-mark-break.ts';

interface BreakingParagraph {
  readonly paragraph: OoxmlElement;
  readonly props: readonly OoxmlProperty[];
}

/**
 * The page-break-before reads of one section's blocks.
 *
 * `breaksBeforeAt` is the authored break, except on an empty section mark after its section's
 * content. `keepsBeforeAtPageStart` says whether a paragraph keeps its space before when it
 * opens a page. The first paragraph of a section does, also when its own page break before
 * opens the page from a continuous section. Any other paragraph with a page break before does
 * only in legacy compatibility modes. Ordinary pagination drops it.
 */
export function pageBreakBeforeRules(
  sectionBlockCount: number,
  compatibilityMode: number | undefined,
  opensSection: () => boolean
) {
  const breakKeepsBefore = hasCompatibilityRule(compatibilityMode, 'pageBreakBeforeKeepsSpace');
  const breaksBeforeAt = (at: number, entry: BreakingParagraph): boolean =>
    paragraphBreaksBefore(entry.props) &&
    !markIgnoresPageBreakBefore(entry.paragraph, at, sectionBlockCount);
  return {
    breaksBeforeAt,
    keepsBeforeAtPageStart: (at: number, entry: BreakingParagraph): boolean =>
      opensSection() || ((breakKeepsBefore || at === 0) && breaksBeforeAt(at, entry)),
  };
}

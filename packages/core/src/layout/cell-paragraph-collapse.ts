import type { OoxmlNode } from '@docx-editor.dev/core/store';
import {
  paragraphMarkMarkupVisible,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';

/**
 * A cell terminator can collapse only when it publishes no intrinsic glyph.
 *
 * Borders and shading use the line box, so a zero-height box hides them. A list marker,
 * tracked pilcrow, or change bar has its own size and would move outside the row instead.
 */
export function cellParagraphPublishesPlacedGlyphs(
  paragraph: OoxmlNode,
  hasListMarker: boolean,
  displayMode: RevisionDisplayMode | undefined,
  revisionAuthorFilter: RevisionAuthorFilter | undefined
): boolean {
  return (
    hasListMarker ||
    (displayMode === 'all-markup' &&
      paragraphMarkMarkupVisible(paragraph, 'all-markup', revisionAuthorFilter))
  );
}

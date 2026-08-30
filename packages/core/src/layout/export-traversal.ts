// Stable, record-only traversal for exporters and other non-DOM consumers.

import type {
  BlockFragmentRecord,
  LineRecord,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  SourceRange,
  StyleSpanRecord,
} from './semantic-records.ts';
import { everyStoryOrder } from './document-order.ts';
import { lineSegments } from './line-segments.ts';

/** Story containing a visited semantic span. @public */
export type SemanticStoryKind =
  | 'body'
  | 'header'
  | 'footer'
  | 'footnote'
  | 'endnote'
  | 'note-separator';

/** One span in the engine's published story order. @public */
export interface SemanticSpanVisit {
  readonly page: PageRecord;
  readonly story: SemanticStoryKind;
  /** Enclosing published fragment; use paragraphId for the authored span owner. */
  readonly paragraph: ParagraphFragmentRecord;
  /** Authored paragraph owning this span, including spans merged into another fragment. */
  readonly paragraphId: string;
  readonly line: LineRecord;
  readonly span: StyleSpanRecord;
  /**
   * Model address for authored text. Projected atoms intentionally return null even though
   * their geometry record carries a range used internally by layout.
   */
  readonly sourceRange: SourceRange | null;
}

/** Return the model address exporters may use, excluding layout-projected atoms. @public */
export function exportSourceRangeOf(span: StyleSpanRecord): SourceRange | null {
  return span.projected === true ? null : span.range;
}

function visitBlocks(
  page: PageRecord,
  story: SemanticStoryKind,
  blocks: readonly BlockFragmentRecord[],
  paragraphOrder: ReadonlyMap<string, number>,
  visitor: (visit: SemanticSpanVisit) => void
): void {
  for (const block of blocks) {
    if (block.kind === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          visitBlocks(page, story, cell.blocks, paragraphOrder, visitor);
        }
      }
      continue;
    }
    for (const line of block.lines) {
      const segments = [...lineSegments(line)].sort(
        (left, right) =>
          (paragraphOrder.get(left.paragraphId) ?? Number.MAX_SAFE_INTEGER) -
          (paragraphOrder.get(right.paragraphId) ?? Number.MAX_SAFE_INTEGER)
      );
      for (const segment of segments) {
        for (const span of segment.spans) {
          visitor({
            page,
            story,
            paragraph: block,
            paragraphId: segment.paragraphId,
            line,
            span,
            sourceRange: exportSourceRangeOf(span),
          });
        }
      }
    }
  }
}

/**
 * Visit every published span in page/story order without consulting the source package.
 * @public
 */
export function forEachSemanticSpan(
  layout: SemanticLayout,
  visitor: (visit: SemanticSpanVisit) => void
): void {
  const paragraphOrder = new Map(
    everyStoryOrder(layout).map((paragraphId, index) => [paragraphId, index])
  );
  for (const page of layout.pages) {
    visitBlocks(page, 'body', page.fragments, paragraphOrder, visitor);
    if (page.header) {
      visitBlocks(page, 'header', page.header.fragments, paragraphOrder, visitor);
    }
    if (page.footer) {
      visitBlocks(page, 'footer', page.footer.fragments, paragraphOrder, visitor);
    }
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      if (area.separator) {
        visitBlocks(page, 'note-separator', area.separator.fragments, paragraphOrder, visitor);
      }
      for (const note of area.notes) {
        visitBlocks(page, note.noteKind, note.fragments, paragraphOrder, visitor);
      }
    }
  }
}

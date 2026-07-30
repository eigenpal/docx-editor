// Revision-tagged semantic layout records over the canonical tree (task 7.1).
//
// These are the records everything downstream reads: interaction derives caret stops and hit
// regions from them (7.4), output paints them without remeasuring (7.5), and the incremental
// engine reuses them by identity (section 9). So they carry two things the painted DOM
// cannot supply back:
//
//   - a REVISION, so a consumer can tell a stale layout from a current one rather than
//     assuming whatever it holds is fresh;
//   - a stable SOURCE RANGE on every line and span — paragraph node id plus UTF-16 offsets —
//     so a position on screen maps to a position in the model without a DOM lookup.
//
// Measurement is a PORT. This package is DOM-free by construction, and a layout that could
// only run in a browser could not be tested deterministically or run headless.

import type { OoxmlProperty } from '@docx-editor.dev/core-contract/store';
import type { ResolvedRunStyle } from './run-style.ts';

/** A half-open UTF-16 range inside one paragraph, addressed by its canonical node id. */
export interface SourceRange {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
}

export interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A run of text on one line sharing identical resolved formatting. */
export interface StyleSpanRecord {
  readonly range: SourceRange;
  readonly text: string;
  /** The run's authored properties, retained as evidence. */
  readonly props: readonly OoxmlProperty[];
  /**
   * The same properties RESOLVED — one unit system, defaults applied.
   *
   * Carried on the span so the measurer, the span and the painter all read one resolution
   * rather than each deriving its own. Two derivations that disagree by a fraction of a
   * point put the caret where no glyph is.
   */
  readonly style: ResolvedRunStyle;
  readonly box: LayoutBox;
}

export interface LineRecord {
  readonly id: string;
  readonly range: SourceRange;
  readonly spans: readonly StyleSpanRecord[];
  readonly box: LayoutBox;
  /** Distance from the line box top to the text baseline. */
  readonly baseline: number;
}

/**
 * The part of one paragraph that sits on one page.
 *
 * A paragraph that crosses a page boundary produces several fragments that all name the SAME
 * `paragraphId`, which is what lets selection and hit-testing treat it as one paragraph while
 * pagination treats it as two boxes.
 */
export interface ParagraphFragmentRecord {
  readonly kind: 'paragraph';
  readonly id: string;
  readonly paragraphId: string;
  /** 0 for the first fragment of the paragraph, 1 for its continuation, and so on. */
  readonly fragmentIndex: number;
  readonly range: SourceRange;
  readonly props: readonly OoxmlProperty[];
  readonly lines: readonly LineRecord[];
  readonly box: LayoutBox;
}

/**
 * The part of one table that sits on one page.
 *
 * A table that crosses a page boundary produces one fragment per page it spans, which is
 * what lets it checkpoint like a paragraph: the flow loop places whole fragments, and
 * resuming after a table needs no knowledge of its interior.
 */
export interface TableFragmentRecord {
  readonly kind: 'table';
  readonly id: string;
  /** Canonical node id of the `w:tbl`. */
  readonly tableId: string;
  /** 0 for the first page the table touches, 1 for its continuation, and so on. */
  readonly fragmentIndex: number;
  readonly rows: readonly TableRowFragmentRecord[];
  readonly box: LayoutBox;
}

export interface TableRowFragmentRecord {
  /** Canonical node id of the `w:tr`. */
  readonly id: string;
  /**
   * True for a `w:tblHeader` row RE-EMITTED at the top of a continuation page. Painted,
   * but excluded from interaction walks so each caret stop exists exactly once.
   */
  readonly isHeaderRepeat: boolean;
  readonly cells: readonly TableCellFragmentRecord[];
  readonly box: LayoutBox;
}

export interface TableCellFragmentRecord {
  /** Canonical node id of the `w:tc`. */
  readonly id: string;
  /** First grid column this cell occupies. */
  readonly gridColumn: number;
  /** Grid columns spanned, already clamped at read time. */
  readonly gridSpan: number;
  /** A vertical-merge continuation paints its box but holds no blocks. */
  readonly vMergeContinue: boolean;
  /** Validated 6-hex cell shading fill, absent for none/auto. */
  readonly shading?: string;
  /** Nested blocks in reading order; recursion carries nested tables. */
  readonly blocks: readonly BlockFragmentRecord[];
  readonly box: LayoutBox;
}

/** A top-level (or cell-level) block fragment, discriminated by `kind`. */
export type BlockFragmentRecord = ParagraphFragmentRecord | TableFragmentRecord;

export interface PageRecord {
  readonly id: string;
  readonly index: number;
  /** The whole sheet. */
  readonly box: LayoutBox;
  /** The area inside the margins that content flows into. */
  readonly contentBox: LayoutBox;
  readonly fragments: readonly BlockFragmentRecord[];
}

export interface SemanticLayout {
  /** The store revision these records were laid out from. */
  readonly revision: number;
  readonly pages: readonly PageRecord[];
}

/** Page geometry, in points. */
export interface PageGeometry {
  readonly width: number;
  readonly height: number;
  readonly margin: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
}

/** US Letter with one-inch margins, in points. */
export const DEFAULT_PAGE_GEOMETRY: PageGeometry = Object.freeze({
  width: 612,
  height: 792,
  margin: Object.freeze({ top: 72, right: 72, bottom: 72, left: 72 }),
});

/**
 * Text measurement, injected.
 *
 * A real implementation shapes with the resolved font; the tests supply a deterministic one.
 * Layout never reads the DOM, so this is the only way width and height enter it.
 */
export interface TextMeasurer {
  /** Advance width of `text` in the resolved style. */
  measure(text: string, style: ResolvedRunStyle): number;
  /** Line height and baseline for the resolved style. */
  lineMetrics(style: ResolvedRunStyle): { height: number; baseline: number };
}

/**
 * Depth-first paragraph fragments of one page, in reading order.
 *
 * Table interiors flatten through rows and cells; header-repeat rows are skipped unless
 * asked for, so interaction sees each caret stop exactly once while paint sees everything.
 */
export function paragraphFragmentsOf(
  page: PageRecord,
  includeHeaderRepeats = false
): ParagraphFragmentRecord[] {
  const found: ParagraphFragmentRecord[] = [];
  const visitBlocks = (blocks: readonly BlockFragmentRecord[]): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        found.push(block);
        continue;
      }
      for (const row of block.rows) {
        if (row.isHeaderRepeat && !includeHeaderRepeats) continue;
        for (const cell of row.cells) visitBlocks(cell.blocks);
      }
    }
  };
  visitBlocks(page.fragments);
  return found;
}

/** Every line in a layout, in reading order — the order caret navigation walks. */
export function linesOf(layout: SemanticLayout): LineRecord[] {
  const lines: LineRecord[] = [];
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) lines.push(...fragment.lines);
  }
  return lines;
}

/** Every fragment belonging to one paragraph, in order, across page boundaries. */
export function fragmentsOfParagraph(
  layout: SemanticLayout,
  paragraphId: string
): ParagraphFragmentRecord[] {
  const fragments: ParagraphFragmentRecord[] = [];
  for (const page of layout.pages) {
    for (const fragment of paragraphFragmentsOf(page)) {
      if (fragment.paragraphId === paragraphId) fragments.push(fragment);
    }
  }
  return fragments.sort((a, b) => a.fragmentIndex - b.fragmentIndex);
}

/** The line containing a model position, or null when the position is not laid out. */
export function lineAtPosition(
  layout: SemanticLayout,
  paragraphId: string,
  offset: number
): LineRecord | null {
  for (const line of linesOf(layout)) {
    if (line.range.paragraphId !== paragraphId) continue;
    // End-inclusive on the last line of a paragraph, so a caret at the very end resolves.
    if (offset >= line.range.start && offset <= line.range.end) return line;
  }
  return null;
}

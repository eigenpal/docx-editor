// What the cells of an autofit table say about its columns beyond their minimums, as the
// minimum measuring in `table-autofit-widths.ts` collects it.
import type { SpanRequirement } from './table-autofit-distribution.ts';

/** What a table's cells say about its columns beyond their minimums. */
export interface AutofitColumnContent {
  /** Each column's widest unwrapped content, with the insets of the widened geometry. */
  readonly maximums: number[];
  /** Columns no single-column cell gives a preferred width: sized by their content. */
  readonly sizedByContent: boolean[];
  /** The widest absolute preferred width a single-column cell states, where one does. */
  readonly preferredWidths: (number | undefined)[];
  /** Columns a single-column cell gives a percentage preferred width. */
  readonly percentColumns: boolean[];
  /** Columns a single-column cell of horizontal text measured. */
  readonly measured: boolean[];
  /** The width each cell of vertical text has across the columns it covers. */
  readonly verticalHolds: SpanRequirement[];
  /** What each cell spanning several columns needs across them. */
  readonly spans: SpanRequirement[];
}

export function emptyColumnContent(): AutofitColumnContent {
  return {
    maximums: [],
    sizedByContent: [],
    preferredWidths: [],
    percentColumns: [],
    measured: [],
    verticalHolds: [],
    spans: [],
  };
}

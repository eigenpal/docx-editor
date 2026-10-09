// Layout work that can pause between units, as generators.
//
// A long table is one block, and laying it out took seconds in one task while a large document
// opened. The table paginator and the layout functions above it are generators: each yield is
// a point where an opening slice may stop and give the page a turn. Every synchronous caller
// drains them, so outside an opening nothing pauses and the answer is the same.

import type { PageRecord, SemanticLayout } from './semantic-records.ts';

/** Body rows a table paginator places between two pause points. */
export const TABLE_ROWS_PER_STEP = 8;

/**
 * The pages a body pass has completed so far, reported between blocks. `finalize` turns a page
 * list into a publishable layout (page fields, list labels) without touching the session, for
 * a host that shows these pages before the pass ends.
 */
export interface LayoutProgress {
  readonly pages: readonly PageRecord[];
  readonly finalize?: (pages: readonly PageRecord[]) => SemanticLayout;
}

/** Steps that end with a `T`, reporting progress at some pause points. */
export type LayoutSteps<T> = Generator<LayoutProgress | void, T, void>;

/** Run `steps` to the end. */
export function drainLayoutSteps<T>(steps: LayoutSteps<T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

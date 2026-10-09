// Layout work that can pause between units, as generators.
//
// A long table is one block, and laying it out took seconds in one task while a large document
// opened. The table paginator and the layout functions above it are generators: each yield is
// a point where an opening slice may stop and give the page a turn. Every synchronous caller
// drains them, so outside an opening nothing pauses and the answer is the same.

/** Body rows a table paginator places between two pause points. */
export const TABLE_ROWS_PER_STEP = 8;

/** Steps that end with a `T`. */
export type LayoutSteps<T> = Generator<void, T, void>;

/** Run `steps` to the end. */
export function drainLayoutSteps<T>(steps: LayoutSteps<T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

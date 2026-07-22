/** @spike-features fixture-comparators, synthetic-128-paragraph-fixture */
export type CounterName =
  | 'measuredParagraphs'
  | 'projectedParagraphs'
  | 'paginatedPages'
  | 'fullDocumentScans'
  | 'fullDocumentRebuilds'
  | 'dependencyEdgeVisits';

export type CounterSnapshot = Readonly<Record<CounterName, number>>;

export type CounterCeilings = Readonly<Record<CounterName, number>>;

export function compareCounterCeilings(
  observed: Partial<Record<CounterName, number>>,
  ceilings: CounterCeilings
): {
  withinCeilings: boolean;
  violations: readonly { counter: CounterName; observed: number; ceiling: number }[];
} {
  const violations: { counter: CounterName; observed: number; ceiling: number }[] = [];
  for (const counter of Object.keys(ceilings) as CounterName[]) {
    const value = observed[counter];
    const ceiling = ceilings[counter]!;
    if (
      value === undefined ||
      !Number.isInteger(value) ||
      value < 0 ||
      !Number.isInteger(ceiling) ||
      ceiling < 0 ||
      value > ceiling
    ) {
      violations.push({ counter, observed: value ?? Number.NaN, ceiling });
    }
  }
  return { withinCeilings: violations.length === 0, violations };
}

export const COUNTER_CEILINGS_COMPARATOR_VERSION = '2.0.0';

import { describe, expect, test } from 'bun:test';
import type { ReviewModuleContribution } from '../../contracts/modules.ts';
import type { OoxmlPackage } from '../../store/package/ooxml-package.ts';
import type { OoxmlElement, OoxmlPart } from '../../store/package/ooxml-tree.ts';
import type { ReviewItem } from '../../store/store/review-items.ts';
import { reviewItemFiltering, withReviewItemFilter } from '../review-item-filter.ts';

const model = () =>
  ({
    displayModes: [],
    collectReviewItems: () => [],
    revisionItemsOfParagraph: () => [],
  }) as unknown as ReviewModuleContribution;
const pkg = {} as OoxmlPackage;
const styles = { root: {} } as OoxmlPart;
const numbering = {} as OoxmlElement;
const items = [
  { kind: 'comment', id: 'a' },
  { kind: 'comment', id: 'b' },
] as unknown as ReviewItem[];

describe('reviewItemFiltering', () => {
  test('hands the list back when the model has no filter', () => {
    const { filtered } = reviewItemFiltering(
      model(),
      pkg,
      { stylesPart: styles, numberingRoot: null },
      null
    );
    expect(filtered(items)).toBe(items);
  });

  test('runs the attached filter with the current inputs', () => {
    const seen: unknown[] = [];
    const filtering = reviewItemFiltering(
      withReviewItemFilter(model(), (list, inputs) => {
        seen.push(inputs);
        return list.slice(1);
      }),
      pkg,
      { stylesPart: styles, numberingRoot: numbering },
      null
    );
    expect(filtering.filtered(items)).toEqual([items[1]!]);
    expect(seen).toEqual([{ pkg, stylesRoot: styles.root, numberingRoot: numbering }]);
  });

  test('reuse holds only while the styles and numbering stay the same', () => {
    const current = { stylesPart: styles, numberingRoot: numbering };
    const same = (previous: typeof current | null) =>
      reviewItemFiltering(model(), pkg, current, previous).sameFilter;
    expect(same(null)).toBe(false);
    expect(same({ stylesPart: styles, numberingRoot: numbering })).toBe(true);
    expect(same({ stylesPart: styles, numberingRoot: {} as OoxmlElement })).toBe(false);
    expect(same({ stylesPart: { root: {} } as OoxmlPart, numberingRoot: numbering })).toBe(false);
  });
});

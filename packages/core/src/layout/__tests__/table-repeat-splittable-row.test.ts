import { expect, test } from 'bun:test';
import { layOut, letterDocument, pageOf, rowsOf, type Row } from './table-letter-fixtures.ts';

// Page 1 holds the lead line, a spacer, the 60pt header row, and the 20pt row a, with 5pt
// left. Row z can split and goes to page 2, below the repeated header.
const headerCase = (z: Row) =>
  letterDocument(648 - 12 - 60 - 20 - 5, [
    { tag: 'h', twips: 1200, header: true },
    { tag: 'a', twips: 400 },
    z,
  ]);

const cases: [string, Row][] = [
  ['one line', { tag: 'z', cantSplit: false, firstLineTwips: 12000 }],
  [
    'a first line and three more lines',
    { tag: 'z', cantSplit: false, firstLineTwips: 12000, lines: 4 },
  ],
  ['lines past the page edge', { tag: 'z', cantSplit: false, firstLineTwips: 12000, lines: 21 }],
  ['a first line taller than the page', { tag: 'z', cantSplit: false, firstLineTwips: 13200 }],
];

for (const [name, z] of cases) {
  for (const compatibilityMode of [undefined, 14]) {
    test(`before mode 15, the header repeats above a splittable row with ${name} whose first line does not fit below it (mode ${compatibilityMode})`, () => {
      const result = layOut(headerCase(z), compatibilityMode);
      const placed = rowsOf(result);
      expect(placed.get('hc1@repeat')!.page).toBe(1);
      const row = placed.get('zc1')!;
      expect(row.page).toBe(1);
      expect(row.row.box.y).toBeCloseTo(60, 6);
      // The row stays whole below the repeat and runs past the 648pt band.
      expect(row.row.hasContinuation).toBeFalsy();
      expect(row.row.box.y + row.row.box.height).toBeGreaterThan(648);
      expect(pageOf(result, 'AFTER')).toBe(2);
    });
  }
}

test('mode 15 omits the header above a splittable row whose first line does not fit below it', () => {
  const result = layOut(headerCase(cases[1]![1]), 15);
  const placed = rowsOf(result);
  expect(placed.has('hc1@repeat')).toBe(false);
  const row = placed.get('zc1')!;
  expect(row.page).toBe(1);
  expect(row.row.box.y).toBe(0);
  expect(row.row.box.y + row.row.box.height).toBeLessThanOrEqual(648 + 0.001);
});

test('before mode 15, a splittable row whose first line fits below the header splits there', () => {
  const result = layOut(
    headerCase({ tag: 'z', cantSplit: false, firstLineTwips: 11000, lines: 6 }),
    14
  );
  const head = rowsOf(result).get('zc1')!;
  expect(head.page).toBe(1);
  expect(head.row.box.y).toBeCloseTo(60, 6);
  expect(head.row.hasContinuation).toBe(true);
  expect(pageOf(result, 'AFTER')).toBe(2);
});

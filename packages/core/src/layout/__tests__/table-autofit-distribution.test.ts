import { describe, expect, test } from 'bun:test';
import { contentSizedWidths, spanAdjustedMinimums } from '../table-autofit-distribution.ts';

const sum = (widths: readonly number[]) => widths.reduce((total, width) => total + width, 0);

describe('columns sized by their content', () => {
  const all = [true, true, true];

  test('a table with room shares it in proportion to each column’s widest line', () => {
    const widths = contentSizedWidths([250, 125, 75], all, [20, 20, 20], [20, 30, 50], 450, 451);
    expect(widths.map((width) => width / 4.5)).toEqual([20, 30, 50]);
  });

  test('a table with no width of its own takes its widest lines, up to its room', () => {
    expect(
      contentSizedWidths([250, 125, 75], all, [20, 20, 20], [20, 30, 50], undefined, 451)
    ).toEqual([20, 30, 50]);
    const capped = contentSizedWidths([1, 1, 1], all, [20, 20, 20], [20, 800, 20], undefined, 451);
    expect(sum(capped)).toBeCloseTo(451, 6);
    // The short columns hold whole; the long one wraps into the rest.
    expect(capped).toEqual([20, 411, 20]);
  });

  test('wrapping moves every column from its minimum toward its widest line alike', () => {
    const widths = contentSizedWidths([1, 1], [true, true], [10, 10], [210, 410], 320, 451);
    // 300 points of the 600 wanted above the minimums: each column gets half its own.
    expect(widths).toEqual([110, 210]);
  });

  test('minimums wider than the room scale down together above their hairlines', () => {
    const widths = contentSizedWidths([1, 1, 1], all, [159, 301, 32], [159, 301, 32], 450, 451);
    expect(sum(widths)).toBeCloseTo(451, 6);
    // Each column keeps its 1 pt hairline; what it holds above that scales alike.
    expect((widths[0]! - 1) / (widths[1]! - 1)).toBeCloseTo(158 / 300, 6);
  });

  test('a column with a preferred width keeps it while the others get their widest lines', () => {
    const mixed = [false, true, true];
    const roomy = contentSizedWidths([125, 1, 1], mixed, [26, 28, 32], [26, 28, 32], 450, 451);
    // 450 - 125 - (28 + 32) = 265 points shared by the content-sized columns' widest lines.
    expect(roomy[0]).toBe(125);
    expect(roomy[1]).toBeCloseTo(28 + (265 * 28) / 60, 6);
    expect(roomy[2]).toBeCloseTo(32 + (265 * 32) / 60, 6);
    // Past that, it gives way first: the others keep their widest lines.
    const tight = contentSizedWidths([125, 1, 1], mixed, [26, 28, 32], [26, 301, 32], 450, 451);
    expect(tight).toEqual([117, 301, 32]);
  });
});

describe('a cell spanning several columns', () => {
  test('raises the spanned columns to its own minimum by width plus content', () => {
    const raised = spanAdjustedMinimums(
      [250, 125, 75],
      [26, 28, 104],
      [26, 28, 104],
      [{ from: 1, count: 2, minimum: 301.7 }]
    );
    const weights = [125 + 28, 104 + 104];
    expect(raised[0]).toBe(26);
    expect(raised[1]).toBeCloseTo((301.7 * weights[0]!) / (weights[0]! + weights[1]!), 6);
    expect(raised[1]! + raised[2]!).toBeCloseTo(301.7, 6);
  });

  test('leaves columns that already hold it alone', () => {
    const minimums = [26, 28, 32];
    expect(
      spanAdjustedMinimums([250, 125, 75], minimums, minimums, [
        { from: 1, count: 2, minimum: 150 },
      ])
    ).toEqual(minimums);
  });

  test('never takes a column below its own minimum', () => {
    const raised = spanAdjustedMinimums(
      [10, 10],
      [5, 90],
      [5, 90],
      [{ from: 0, count: 2, minimum: 140 }]
    );
    expect(raised[0]).toBeGreaterThanOrEqual(5);
    expect(raised[1]).toBeGreaterThanOrEqual(90);
    expect(raised[0]! + raised[1]!).toBeCloseTo(140, 6);
  });
});

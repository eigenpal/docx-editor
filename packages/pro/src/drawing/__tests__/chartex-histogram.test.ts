/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Histogram and Pareto charts, with the rules measured against reference renderings: the
// automatic bin width, bin edges and closed sides, cutoff bins, label text, aggregation and
// Pareto order, the cumulative line on its own percent axis, and the bounds on file counts.

import { describe, expect, test } from 'bun:test';
import {
  projectDrawingsInPackage,
  type DrawingProjection,
} from '../../../../core/src/store/package/drawing-projection.ts';
import type { OoxmlElement, OoxmlNode } from '../../../../core/src/store/package/ooxml-tree.ts';
import { CX, chartexPackage } from '../../../../core/src/store/__tests__/chartex-fixture.ts';
import {
  aggregateColumns,
  automaticBinWidth,
  cumulativeShares,
  histogramColumns,
  paretoOrder,
  roundBinWidth,
  type Binning,
} from '../chartex-histogram-bins.ts';
import { installDrawing } from '../index.ts';

installDrawing();

const EMU = 12_700;
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Twenty integers from 2 to 49. */
const U20 = [9, 37, 49, 5, 17, 8, 32, 49, 29, 31, 42, 25, 14, 7, 32, 2, 25, 28, 39, 49];
/** Forty decimals from -5 to 4.51. */
const NEG40 = [
  2.93, 3.22, -0.15, -2.38, -5.0, 1.63, -0.3, 2.6, -1.27, 2.7, -2.27, 3.02, 2.3, -0.86, 0.38, 1.82,
  -3.07, 0.54, 3.05, -2.34, 3.03, 1.86, 3.44, -1.64, -4.07, 3.0, 3.05, -0.55, -4.06, -3.03, 1.35,
  -2.09, 4.51, 0.89, -2.99, 1.55, -1.4, 4.33, 4.1, 0.15,
];
const SEQ = Array.from({ length: 15 }, (_, index) => index);

function binning(over: Partial<Binning> = {}): Binning {
  return { closed: 'r', size: null, count: null, underflow: null, overflow: null, ...over };
}

function bins(values: readonly (number | null)[], over: Partial<Binning> = {}, format = null) {
  return histogramColumns(values, binning(over), format)!.map((c) => [c.label, c.value]);
}

describe('automatic bin width', () => {
  test("Scott's rule, rounded to two significant digits but never finer than 0.01", () => {
    const cases: [number, number][] = [
      [19.748, 20],
      [11.519, 12],
      [0.26615, 0.27],
      [28.499, 28],
      [23039.95, 23000],
      [2.7048, 2.7],
      [0.1276, 0.13],
      [0.0135, 0.01],
      [0.0151, 0.02],
      [0.0249, 0.02],
      [0.0251, 0.03],
      [0.096, 0.1],
      [0.995, 1],
      [9.96, 10],
      [0.0051, 0.01],
      [0.0049, 0],
    ];
    for (const [raw, rounded] of cases) expect(roundBinWidth(raw)).toBe(rounded);
  });

  test('uses the sample standard deviation over the cube root of the count', () => {
    // 3.5 * s / cbrt(20) = 19.75 for these values.
    expect(automaticBinWidth(U20)).toBe(20);
    expect(automaticBinWidth(NEG40)).toBe(2.7);
  });

  test('one value, equal values or a tiny spread give width 5', () => {
    expect(automaticBinWidth([17])).toBe(5);
    expect(automaticBinWidth([4, 4, 4, 4])).toBe(5);
    expect(automaticBinWidth([1000.001, 1000.002, 1000.002, 1000.003])).toBe(5);
    expect(bins([4, 4, 4, 4, 4])).toEqual([['[4, 9]', 5]]);
  });

  test('bins start at the smallest value, the first closed on both sides', () => {
    expect(bins(U20)).toEqual([
      ['[2, 22]', 7],
      ['(22, 42]', 10],
      ['(42, 62]', 3],
    ]);
    expect(bins(NEG40)).toEqual([
      ['[-5, -2.3]', 8],
      ['(-2.3, 0.4]', 11],
      ['(0.4, 3.1]', 16],
      ['(3.1, 5.8]', 5],
    ]);
  });
});

describe('explicit bins and closed sides', () => {
  test('a bin size covers the range; the value on an edge goes to the closed side', () => {
    expect(bins(SEQ, { size: 7 })).toEqual([
      ['[0, 7]', 8],
      ['(7, 14]', 7],
    ]);
    expect(bins(SEQ, { size: 7, closed: 'l' })).toEqual([
      ['[0, 7)', 7],
      ['[7, 14]', 8],
    ]);
    expect(bins([1, 2, 2, 3, 3, 3, 4], { size: 1 })).toEqual([
      ['[1, 2]', 3],
      ['(2, 3]', 3],
      ['(3, 4]', 1],
    ]);
  });

  test('a bin count splits the range evenly', () => {
    expect(bins(U20, { count: 4 })).toEqual([
      ['[2, 13.75]', 5],
      ['(13.75, 25.5]', 4],
      ['(25.5, 37.25]', 6],
      ['(37.25, 49]', 5],
    ]);
    expect(bins(SEQ, { count: 7, closed: 'l' }).map(([label]) => label)).toEqual([
      '[0, 2)',
      '[2, 4)',
      '[4, 6)',
      '[6, 8)',
      '[8, 10)',
      '[10, 12)',
      '[12, 14]',
    ]);
    expect(bins(NEG40, { count: 7 })[1]![0]).toBe('(-3.641428571, -2.282857143]');
    expect(bins([7, 7, 7, 7, 7], { count: 3 })).toEqual([
      ['[7, 7]', 5],
      ['(7, 7]', 0],
      ['(7, 7]', 0],
    ]);
  });

  test('underflow and overflow bins, on either closed side', () => {
    const cut = { size: 10, underflow: 10, overflow: 40 };
    expect(bins(U20, cut)).toEqual([
      ['≤ 10', 5],
      ['(10, 20]', 2],
      ['(20, 30]', 4],
      ['(30, 40]', 5],
      ['> 40', 4],
    ]);
    expect(bins(U20, { ...cut, closed: 'l' }).map(([label]) => label)).toEqual([
      '< 10',
      '[10, 20)',
      '[20, 30)',
      '[30, 40)',
      '≥ 40',
    ]);
  });

  test('cutoff bins count toward a bin count; the last inner bin ends at the overflow', () => {
    expect(bins(U20, { count: 5, underflow: 10, overflow: 40 }).map(([l]) => l)).toEqual([
      '≤ 10',
      '(10, 20]',
      '(20, 30]',
      '(30, 40]',
      '> 40',
    ]);
    expect(bins(U20, { count: 4, overflow: 30 }).map(([l]) => l)).toEqual([
      '[2, 11.33333333]',
      '(11.33333333, 20.66666667]',
      '(20.66666667, 30]',
      '> 30',
    ]);
    expect(bins(U20, { size: 10, overflow: 30 }).map(([l]) => l)).toEqual([
      '[2, 12]',
      '(12, 22]',
      '(22, 30]',
      '> 30',
    ]);
    expect(bins(U20, { count: 2, underflow: 10, overflow: 40 })).toEqual([
      ['≤ 10', 5],
      ['> 40', 15],
    ]);
    // The automatic width comes from every value, and the bins start at the underflow.
    expect(bins(U20, { underflow: 10 }).map(([l]) => l)).toEqual(['≤ 10', '(10, 30]', '(30, 50]']);
  });

  test('a cutoff outside the values, or an overflow under the underflow, is ignored', () => {
    const plain = bins(U20);
    expect(bins(U20, { underflow: 60 })).toEqual(plain);
    expect(bins(U20, { overflow: -5 })).toEqual(plain);
    expect(bins(U20, { size: 10, underflow: 2 })[0]![0]).toBe('[2, 12]');
    expect(bins(U20, { size: 10, overflow: 49, closed: 'l' }).at(-1)![0]).toBe('[42, 52]');
    expect(bins(U20, { size: 10, underflow: 30, overflow: 20 })).toEqual([
      ['≤ 30', 11],
      ['(30, 40]', 5],
      ['(40, 50]', 4],
    ]);
  });

  test('edges take the number format of the values', () => {
    expect(histogramColumns(NEG40, null, '0.0')!.map((c) => c.label)).toEqual([
      '[-5.0, -2.3]',
      '(-2.3, 0.4]',
      '(0.4, 3.1]',
      '(3.1, 5.8]',
    ]);
    const shares = NEG40.map((value) => value / 10);
    expect(histogramColumns(shares, null, '0%')![0]!.label).toBe('[-50%, -23%]');
  });
});

describe('model edge cases', () => {
  test('no values, no columns; values without a number are skipped', () => {
    expect(histogramColumns([], null, null)).toEqual([]);
    expect(histogramColumns([null, Number.NaN], null, null)).toEqual([]);
    expect(bins([null, 2, Number.NaN, 4, Number.POSITIVE_INFINITY], { size: 1 })).toEqual([
      ['[2, 3]', 1],
      ['(3, 4]', 1],
    ]);
  });

  test('a file-supplied bin count or width past the bound refuses, without the work', () => {
    const started = performance.now();
    expect(histogramColumns(U20, binning({ count: 1_000_000_000 }), null)).toBeNull();
    expect(histogramColumns(U20, binning({ size: 1e-12 }), null)).toBeNull();
    expect(histogramColumns([0, 1e300, -1e300], null, null)).toBeNull();
    expect(performance.now() - started).toBeLessThan(50);
    expect(histogramColumns(U20, binning({ count: 1_000 }), null)).toHaveLength(1_000);
  });

  test('values whose span overflows the number range refuse, with any binning', () => {
    const huge = [-1e308, 1e308, 3];
    expect(histogramColumns(huge, binning({ count: 3 }), null)).toBeNull();
    expect(histogramColumns(huge, binning({ size: 1e300 }), null)).toBeNull();
    expect(histogramColumns(huge, null, null)).toBeNull();
    // A finite span next to the range limit still bins with finite edges.
    const edges = histogramColumns([1.7e308, 1.79e308], binning({ count: 2 }), null)!;
    expect(edges).toHaveLength(2);
    expect(edges.every((column) => !/NaN|Infinity/.test(column.label))).toBe(true);
  });

  test('a bin count the cutoff bins use up leaves only the cutoff bins', () => {
    // As measured with a bin count of 2: every value over the underflow counts as overflow.
    expect(bins(U20, { count: 1, underflow: 10, overflow: 40 })).toEqual(
      bins(U20, { count: 2, underflow: 10, overflow: 40 })
    );
  });
});

describe('aggregation and Pareto order', () => {
  test('values sum per category; a negative sum is left out', () => {
    const columns = aggregateColumns(['A', 'B', 'C', 'B', 'D', 'E', 'E'], [6, 5, 0, -2, 4, -3, 1]);
    expect(columns.map((c) => [c.label, c.value])).toEqual([
      ['A', 6],
      ['B', 3],
      ['C', 0],
      ['D', 4],
    ]);
    expect(paretoOrder(columns).map((c) => c.label)).toEqual(['A', 'D', 'B', 'C']);
  });

  test('largest first, equal columns in their order, and the running share', () => {
    const columns = aggregateColumns(
      ['A', 'B', 'A', 'C', 'D', 'B', 'E', 'F'],
      [5, 7, 4, 9, 9, 2, 1, 9]
    );
    const sorted = paretoOrder(columns);
    expect(sorted.map((c) => c.label)).toEqual(['A', 'B', 'C', 'D', 'F', 'E']);
    const shares = cumulativeShares(sorted);
    expect(shares[0]).toBeCloseTo(9 / 46, 9);
    expect(shares.at(-1)).toBe(1);
    expect(cumulativeShares([{ label: 'x', value: 0 }])).toEqual([0]);
  });
});

// ---- Rendering ----

interface ChartOptions {
  readonly values: readonly number[];
  readonly categories?: readonly string[];
  readonly layoutPr?: string;
  readonly pareto?: boolean;
  readonly gap?: string | null;
  readonly legend?: boolean;
  readonly formatCode?: string;
}

function chartSpace(options: ChartOptions): string {
  const { values, categories } = options;
  const points = (list: readonly (string | number)[]) =>
    list.map((value, index) => `<cx:pt idx="${index}">${value}</cx:pt>`).join('');
  const dims =
    (categories
      ? `<cx:strDim type="cat"><cx:lvl ptCount="${categories.length}">${points(categories)}</cx:lvl></cx:strDim>`
      : '') +
    `<cx:numDim type="val"><cx:lvl ptCount="${values.length}" formatCode="${options.formatCode ?? 'General'}">${points(values)}</cx:lvl></cx:numDim>`;
  const gap = options.gap === null ? '' : ` gapWidth="${options.gap ?? '0'}"`;
  const line = options.pareto
    ? '<cx:axisId val="1"/></cx:series><cx:series layoutId="paretoLine" ownerIdx="0"><cx:axisId val="2"/></cx:series>'
    : '</cx:series>';
  const percentAxis = options.pareto
    ? '<cx:axis id="2"><cx:valScaling max="1" min="0"/><cx:units unit="percentage"/><cx:tickLabels/></cx:axis>'
    : '';
  return (
    `<cx:chartSpace xmlns:cx="${CX}" xmlns:a="${A}" xmlns:r="${R}"><cx:chartData><cx:data id="0">${dims}</cx:data></cx:chartData>` +
    '<cx:chart><cx:plotArea><cx:plotAreaRegion><cx:series layoutId="clusteredColumn">' +
    '<cx:tx><cx:txData><cx:v>Values</cx:v></cx:txData></cx:tx>' +
    '<cx:dataLabels pos="outEnd"><cx:visibility seriesName="0" categoryName="0" value="1"/></cx:dataLabels>' +
    `<cx:dataId val="0"/><cx:layoutPr>${options.layoutPr ?? '<cx:binning intervalClosed="r"/>'}</cx:layoutPr>${line}` +
    `</cx:plotAreaRegion><cx:axis id="0"><cx:catScaling${gap}/><cx:tickLabels/></cx:axis>` +
    `<cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis>${percentAxis}</cx:plotArea>` +
    `${options.legend ? '<cx:legend pos="t" align="ctr" overlay="0"/>' : ''}</cx:chart></cx:chartSpace>`
  );
}

function project(options: ChartOptions): DrawingProjection {
  const projections = projectDrawingsInPackage(
    chartexPackage(chartSpace(options), { alternateContent: true })
  );
  expect(projections).toHaveLength(1);
  return projections[0]!;
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return (node as OoxmlElement).children.map(textOf).join('');
}

function labels(projection: DrawingProjection) {
  return (projection.groupTextboxes ?? []).map((box) => ({
    text: textOf(box.story.content),
    left: box.frameEmu.x / EMU,
    y: (box.frameEmu.y + box.frameEmu.cy / 2) / EMU,
  }));
}

function bars(projection: DrawingProjection) {
  const out: { l: number; t: number; r: number; b: number }[] = [];
  for (const component of projection.vectorShape?.components ?? []) {
    if (component.fillHex !== '4472C4') continue;
    const path = component.subpathsEmu[0]!;
    const xs = path.map((point) => point.x / EMU);
    const ys = path.map((point) => point.y / EMU);
    const bar = { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
    if (bar.r - bar.l > 10) out.push(bar);
  }
  return out.sort((a, b) => a.l - b.l);
}

describe('histogram rendering', () => {
  test('one column per bin, touching at gap 0, labelled with the bin text and count', () => {
    const projection = project({ values: U20 });
    // A drawn chart keeps its summary too.
    expect(projection.chartSummary?.plotTypes).toEqual(['histogram']);
    const columns = bars(projection);
    expect(columns).toHaveLength(3);
    expect(columns[1]!.l).toBeCloseTo(columns[0]!.r, 3);
    const texts = labels(projection).map((label) => label.text);
    for (const text of ['[2, 22]', '(22, 42]', '(42, 62]', '7', '10', '3']) {
      expect(texts).toContain(text);
    }
  });

  test('without a gap width a third of a column separates the columns', () => {
    const columns = bars(project({ values: U20, gap: null }));
    const slot = columns[1]!.l - columns[0]!.l;
    expect(columns[0]!.r - columns[0]!.l).toBeCloseTo(slot / (4 / 3), 2);
  });

  test('an empty bin paints no column', () => {
    const columns = bars(
      project({ values: [1, 2, 9, 10], layoutPr: '<cx:binning><cx:binSize val="3"/></cx:binning>' })
    );
    expect(columns).toHaveLength(2);
  });

  test('binned counts keep the general format, also when the series has categories', () => {
    const texts = labels(
      project({
        values: [0.11, 0.12, 0.25, 0.31],
        categories: ['a', 'b', 'c', 'd'],
        formatCode: '0.00%',
        layoutPr: '<cx:binning intervalClosed="r"><cx:binSize val="0.1"/></cx:binning>',
      })
    ).map((label) => label.text);
    expect(texts).toContain('[11.00%, 21.00%]');
    // Two column labels, and the value axis tick at 2.
    expect(texts.filter((text) => text === '2')).toHaveLength(3);
    expect(texts).not.toContain('200.00%');
  });

  test('a bin count past the bound does not paint the chart', () => {
    const projection = project({
      values: U20,
      layoutPr: '<cx:binning><cx:binCount val="999999999"/></cx:binning>',
    });
    expect(projection.vectorShape ?? null).toBeNull();
  });
});

describe('Pareto rendering', () => {
  const categories = ['Late', 'Damaged', 'Wrong item', 'Missing', 'Other', 'Billing'];
  const values = [12, 30, 7, 18, 3, 9];
  const projection = project({
    values,
    categories,
    layoutPr: '<cx:aggregation/>',
    pareto: true,
    legend: true,
  });

  test('columns sort largest first', () => {
    const columns = bars(projection);
    expect(columns).toHaveLength(6);
    const heights = columns.map((bar) => bar.b - bar.t);
    expect([...heights].sort((a, b) => b - a)).toEqual(heights);
    const texts = labels(projection).map((label) => label.text);
    expect(texts.indexOf('Damaged')).toBeLessThan(texts.indexOf('Missing'));
  });

  test('the line joins the running share at each column centre, on a 0% to 100% axis', () => {
    const line = (projection.vectorShape?.components ?? []).find(
      (component) => component.strokeHex === 'ED7D31'
    );
    expect(line).toBeDefined();
    const points = line!.subpathsEmu[0]!.map((point) => ({ x: point.x / EMU, y: point.y / EMU }));
    const columns = bars(projection);
    expect(points).toHaveLength(6);
    for (const [index, point] of points.entries()) {
      expect(point.x).toBeCloseTo((columns[index]!.l + columns[index]!.r) / 2, 1);
    }
    const texts = labels(projection);
    const zero = texts.find((label) => label.text === '0%')!;
    const full = texts.find((label) => label.text === '100%')!;
    const at = (share: number) => zero.y + (full.y - zero.y) * share;
    const total = 79;
    let running = 0;
    for (const [index, value] of [30, 18, 12, 9, 7, 3].entries()) {
      running += value;
      expect(points[index]!.y).toBeCloseTo(at(running / total), 1);
    }
    // The percent labels sit right of the plot, left-aligned on one edge.
    expect(full.left).toBeCloseTo(zero.left, 3);
    expect(full.left).toBeGreaterThan(columns.at(-1)!.r);
  });

  test('the legend lists the columns only', () => {
    const texts = labels(projection).map((label) => label.text);
    expect(texts.filter((text) => text === 'Values')).toHaveLength(1);
  });
});

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Box and whisker charts, with the rules measured against reference renderings: quartiles by
// the exclusive and inclusive positions, whiskers to the furthest value within one and a half
// box heights, outliers and inner points as diamonds, the mean as an x mark and a mean line,
// series side by side in the share of the slot the gap leaves, and the series outline at
// eight tenths of the data colour.

import { describe, expect, test } from 'bun:test';
import {
  projectDrawingsInPackage,
  type DrawingProjection,
} from '../../../../core/src/store/package/drawing-projection.ts';
import { CX, chartexPackage } from '../../../../core/src/store/__tests__/chartex-fixture.ts';
import {
  boxWhiskerGroups,
  boxWhiskerStatistics,
  quartileOf,
  type QuartileMethod,
} from '../chartex-box-whisker.ts';
import { installDrawing } from '../index.ts';

installDrawing();

const EMU = 12_700;
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

interface ChartOptions {
  /** One list of [category, value] pairs per series. */
  readonly series?: readonly (readonly (readonly [string, number])[])[];
  readonly method?: QuartileMethod;
  readonly meanLine?: boolean;
  readonly meanMarker?: boolean;
  readonly inner?: boolean;
  readonly outliers?: boolean;
  readonly gap?: number;
  readonly legend?: boolean;
  readonly seriesSpPr?: string;
  /** Raw `ptCount` of the first series' levels. */
  readonly ptCount?: number;
}

function pairs(groups: readonly (readonly [string, readonly number[]])[]) {
  return groups.flatMap(([category, values]) => values.map((value) => [category, value] as const));
}

const METHOD_DATA = pairs([
  ['Six', [2, 4, 7, 11, 16, 22]],
  ['Eight', [1, 3, 6, 10, 15, 21, 28, 36]],
  ['Seven', [5, 6, 9, 13, 18, 24, 31]],
]);
const OUTLIER_DATA = pairs([
  ['North', [-40, 10, 12, 13, 14, 15, 16, 17, 18, 60, 75]],
  ['West', [15, 18, 20, 22, 24, 26]],
]);

function boxWhiskerChartSpace(options: ChartOptions = {}): string {
  const series = options.series ?? [METHOD_DATA];
  const points = (list: readonly (string | number)[]) =>
    list.map((value, index) => `<cx:pt idx="${index}">${value}</cx:pt>`).join('');
  const data = series
    .map((list, index) => {
      const count = index === 0 && options.ptCount !== undefined ? options.ptCount : list.length;
      return (
        `<cx:data id="${index}"><cx:strDim type="cat"><cx:lvl ptCount="${count}">` +
        `${points(list.map(([category]) => category))}</cx:lvl></cx:strDim>` +
        `<cx:numDim type="val"><cx:lvl ptCount="${count}" formatCode="General">` +
        `${points(list.map(([, value]) => value))}</cx:lvl></cx:numDim></cx:data>`
      );
    })
    .join('');
  const flag = (value: boolean | undefined, fallback: boolean) => ((value ?? fallback) ? '1' : '0');
  const seriesXml = series
    .map(
      (_, index) =>
        `<cx:series layoutId="boxWhisker" formatIdx="${index}">` +
        `<cx:tx><cx:txData><cx:v>Team ${index + 1}</cx:v></cx:txData></cx:tx>` +
        `${options.seriesSpPr ?? ''}<cx:dataId val="${index}"/><cx:layoutPr>` +
        `<cx:visibility meanLine="${flag(options.meanLine, false)}" ` +
        `meanMarker="${flag(options.meanMarker, true)}" nonoutliers="${flag(options.inner, false)}" ` +
        `outliers="${flag(options.outliers, true)}"/>` +
        `<cx:statistics quartileMethod="${options.method ?? 'exclusive'}"/></cx:layoutPr></cx:series>`
    )
    .join('');
  const gap = options.gap === undefined ? '' : ` gapWidth="${options.gap}"`;
  return (
    `<cx:chartSpace xmlns:cx="${CX}" xmlns:a="${A}"><cx:chartData>${data}</cx:chartData>` +
    `<cx:chart><cx:plotArea><cx:plotAreaRegion>${seriesXml}</cx:plotAreaRegion>` +
    `<cx:axis id="0"><cx:catScaling${gap}/><cx:tickLabels/></cx:axis>` +
    '<cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis>' +
    `</cx:plotArea>${options.legend ? '<cx:legend pos="t" align="ctr" overlay="0"/>' : ''}` +
    '</cx:chart></cx:chartSpace>'
  );
}

function project(options: ChartOptions = {}): DrawingProjection {
  const projections = projectDrawingsInPackage(
    chartexPackage(boxWhiskerChartSpace(options), { alternateContent: true })
  );
  expect(projections).toHaveLength(1);
  return projections[0]!;
}

interface Shape {
  readonly fill: string | null;
  readonly stroke: string | null;
  readonly widthPt: number;
  readonly paths: { x: number; y: number }[][];
  readonly l: number;
  readonly t: number;
  readonly r: number;
  readonly b: number;
}

function shapes(projection: DrawingProjection): Shape[] {
  return (projection.vectorShape?.components ?? []).map((component) => {
    const paths = component.subpathsEmu.map((path) =>
      path.map((point) => ({ x: point.x / EMU, y: point.y / EMU }))
    );
    const xs = paths.flat().map((point) => point.x);
    const ys = paths.flat().map((point) => point.y);
    return {
      fill: component.fillHex,
      stroke: component.strokeHex,
      widthPt: component.strokeWidthEmu / EMU,
      paths,
      l: Math.min(...xs),
      t: Math.min(...ys),
      r: Math.max(...xs),
      b: Math.max(...ys),
    };
  });
}

/** Filled boxes: wider than a point, in paint order. */
function boxes(projection: DrawingProjection): Shape[] {
  return shapes(projection).filter(
    (shape) => shape.fill && shape.fill !== 'FFFFFF' && shape.r - shape.l > 8
  );
}

/** Filled diamonds. */
function diamonds(projection: DrawingProjection): Shape[] {
  return shapes(projection).filter(
    (shape) => shape.fill && shape.fill !== 'FFFFFF' && shape.r - shape.l < 4
  );
}

/** Open strokes in `hex`. */
function strokes(projection: DrawingProjection, hex: string): Shape[] {
  return shapes(projection).filter((shape) => !shape.fill && shape.stroke === hex);
}

/** Major gridline positions, top to bottom, and the value each stands for. */
function valueScale(projection: DrawingProjection, values: readonly number[]) {
  const grid = shapes(projection).find((shape) => !shape.fill && shape.stroke === 'D9D9D9')!;
  const ys = grid.paths.map((path) => path[0]!.y).sort((a, b) => b - a);
  const perUnit = (ys[0]! - ys[ys.length - 1]!) / (values[values.length - 1]! - values[0]!);
  return (value: number) => ys[0]! - (value - values[0]!) * perUnit;
}

describe('quartiles', () => {
  const six = [2, 4, 7, 11, 16, 22];
  const eight = [1, 3, 6, 10, 15, 21, 28, 36];
  const seven = [5, 6, 9, 13, 18, 24, 31];

  test('exclusive quartiles interpolate at (n + 1)q', () => {
    expect(quartileOf(six, 0.25, 'exclusive')).toBeCloseTo(3.5, 10);
    expect(quartileOf(six, 0.75, 'exclusive')).toBeCloseTo(17.5, 10);
    expect(quartileOf(eight, 0.25, 'exclusive')).toBeCloseTo(3.75, 10);
    expect(quartileOf(eight, 0.75, 'exclusive')).toBeCloseTo(26.25, 10);
    expect(quartileOf(seven, 0.25, 'exclusive')).toBe(6);
    expect(quartileOf(seven, 0.75, 'exclusive')).toBe(24);
  });

  test('inclusive quartiles interpolate at (n - 1)q + 1', () => {
    expect(quartileOf(six, 0.25, 'inclusive')).toBeCloseTo(4.75, 10);
    expect(quartileOf(six, 0.75, 'inclusive')).toBeCloseTo(14.75, 10);
    expect(quartileOf(eight, 0.25, 'inclusive')).toBeCloseTo(5.25, 10);
    expect(quartileOf(eight, 0.75, 'inclusive')).toBeCloseTo(22.75, 10);
    expect(quartileOf(seven, 0.25, 'inclusive')).toBe(7.5);
    expect(quartileOf(seven, 0.75, 'inclusive')).toBe(21);
  });

  test('the median is the same for both methods', () => {
    for (const method of ['exclusive', 'inclusive'] as const) {
      expect(quartileOf(six, 0.5, method)).toBe(9);
      expect(quartileOf(seven, 0.5, method)).toBe(13);
    }
  });

  test('positions past the ends hold to the first and last value', () => {
    expect(quartileOf([6, 14], 0.25, 'exclusive')).toBe(6);
    expect(quartileOf([6, 14], 0.75, 'exclusive')).toBe(14);
    expect(quartileOf([6, 14], 0.25, 'inclusive')).toBe(8);
    expect(quartileOf([4, 9, 20], 0.25, 'exclusive')).toBe(4);
    expect(quartileOf([4, 9, 20], 0.75, 'exclusive')).toBe(20);
    expect(quartileOf([10], 0.25, 'exclusive')).toBe(10);
    expect(quartileOf([10], 0.75, 'inclusive')).toBe(10);
    expect(quartileOf([], 0.5, 'inclusive')).toBeNaN();
  });
});

describe('whiskers and outliers', () => {
  const north = [-40, 10, 12, 13, 14, 15, 16, 17, 18, 60, 75];

  test('whiskers reach the furthest values within one and a half box heights', () => {
    const stats = boxWhiskerStatistics(north, 'inclusive')!;
    expect(stats.firstQuartile).toBe(12.5);
    expect(stats.thirdQuartile).toBe(17.5);
    expect(stats.whiskerLow).toBe(10);
    expect(stats.whiskerHigh).toBe(18);
    expect(stats.outliers).toEqual([-40, 60, 75]);
  });

  test('inner points lie strictly between the whisker ends', () => {
    expect(boxWhiskerStatistics(north, 'inclusive')!.inner).toEqual([12, 13, 14, 15, 16, 17]);
  });

  test('the mean counts every value, outliers too', () => {
    expect(boxWhiskerStatistics(north, 'exclusive')!.mean).toBeCloseTo(210 / 11, 10);
  });

  test('a single value is its own box, whiskers and mean', () => {
    expect(boxWhiskerStatistics([10], 'exclusive')).toEqual({
      count: 1,
      firstQuartile: 10,
      median: 10,
      thirdQuartile: 10,
      mean: 10,
      whiskerLow: 10,
      whiskerHigh: 10,
      outliers: [],
      inner: [],
    });
  });

  test('no finite value draws no box; non-finite values are skipped', () => {
    expect(boxWhiskerStatistics([], 'exclusive')).toBeNull();
    expect(boxWhiskerStatistics([Number.NaN, Number.POSITIVE_INFINITY], 'exclusive')).toBeNull();
    const stats = boxWhiskerStatistics(
      [Number.NaN, 4, 9, 20, Number.NEGATIVE_INFINITY],
      'exclusive'
    )!;
    expect(stats.count).toBe(3);
    expect(stats.median).toBe(9);
  });

  test('a large group stays numeric and sorted without a comparator', () => {
    const values = Array.from({ length: 4_096 }, (_, index) => (index * 7_919) % 4_096);
    const stats = boxWhiskerStatistics(values, 'inclusive')!;
    expect(stats.count).toBe(4_096);
    expect(stats.median).toBeCloseTo(2_047.5, 10);
    expect(stats.whiskerLow).toBe(0);
    expect(stats.whiskerHigh).toBe(4_095);
  });
});

describe('groups', () => {
  test('values group by category text in first-seen order across series', () => {
    const groups = boxWhiskerGroups([
      { categories: ['b', 'a', 'b', null], values: [1, 2, 3, 4] },
      { categories: ['c', 'a', '__proto__'], values: [5, null, 6] },
    ]);
    expect(groups.categories).toEqual(['b', 'a', '', 'c', '__proto__']);
    expect(groups.values[0]).toEqual([[1, 3], [2], [4]]);
    expect(groups.values[1]![3]).toEqual([5]);
    expect(groups.values[1]![4]).toEqual([6]);
    expect(groups.values[1]![1]).toBeUndefined();
  });
});

describe('painted boxes', () => {
  test('boxes span the quartiles with the median across them', () => {
    const projection = project();
    // A drawn chart keeps its summary too.
    expect(projection.chartSummary?.plotTypes).toEqual(['boxWhisker']);
    const painted = boxes(projection);
    expect(painted).toHaveLength(3);
    const y = valueScale(projection, [0, 5, 10, 15, 20, 25, 30, 35, 40]);
    expect(painted[0]!.t).toBeCloseTo(y(17.5), 1);
    expect(painted[0]!.b).toBeCloseTo(y(3.5), 1);
    expect(painted[0]!.fill).toBe('4472C4');
    expect(painted[0]!.stroke).toBe('365B9D');
    const median = strokes(projection, '365B9D').find(
      (shape) => Math.abs(shape.t - y(9)) < 0.05 && shape.r - shape.l > 20
    );
    expect(median?.l).toBeCloseTo(painted[0]!.l, 3);
    expect(median?.r).toBeCloseTo(painted[0]!.r, 3);
  });

  test('inclusive quartiles narrow the boxes of even counts', () => {
    const projection = project({ method: 'inclusive' });
    const y = valueScale(projection, [0, 5, 10, 15, 20, 25, 30, 35, 40]);
    const [six] = boxes(projection);
    expect(six!.t).toBeCloseTo(y(14.75), 1);
    expect(six!.b).toBeCloseTo(y(4.75), 1);
  });

  test('without a gap a box takes three quarters of its slot; a gap of 1 half', () => {
    const auto = boxes(project());
    const slot = (auto[1]!.l + auto[1]!.r) / 2 - (auto[0]!.l + auto[0]!.r) / 2;
    expect(auto[0]!.r - auto[0]!.l).toBeCloseTo(slot * 0.75, 2);
    const half = boxes(project({ gap: 1 }));
    expect(half[0]!.r - half[0]!.l).toBeCloseTo(slot / 2, 2);
  });

  test('whisker caps are three tenths of the box, centred on it', () => {
    const projection = project();
    const [box] = boxes(projection);
    const width = box!.r - box!.l;
    const whiskers = strokes(projection, '365B9D').find((shape) => shape.paths.length === 4)!;
    const cap = whiskers.paths[0]!;
    expect(cap[1]!.x - cap[0]!.x).toBeCloseTo(0.3 * width, 3);
    expect((cap[0]!.x + cap[1]!.x) / 2).toBeCloseTo((box!.l + box!.r) / 2, 3);
  });

  test('the mean is an x mark 6 pt across', () => {
    const projection = project();
    const marks = strokes(projection, '365B9D').filter(
      (shape) => shape.paths.length === 2 && Math.abs(shape.r - shape.l - 6) < 1e-6
    );
    expect(marks).toHaveLength(3);
    const y = valueScale(projection, [0, 5, 10, 15, 20, 25, 30, 35, 40]);
    expect((marks[0]!.t + marks[0]!.b) / 2).toBeCloseTo(y(62 / 6), 1);
    expect(project({ meanMarker: false }).vectorShape!.components.length).toBe(
      projection.vectorShape!.components.length - 3
    );
  });

  test('a mean line joins the means only when asked for', () => {
    const lines = (projection: DrawingProjection) =>
      strokes(projection, '365B9D').filter(
        (shape) => shape.paths.length === 1 && shape.paths[0]!.length === 3
      );
    expect(lines(project())).toHaveLength(0);
    const [line] = lines(project({ meanLine: true }));
    expect(line).toBeDefined();
  });

  test('outliers are diamonds; inner points join them when asked for', () => {
    expect(diamonds(project({ series: [OUTLIER_DATA] }))).toHaveLength(3);
    // North: 12 to 17 between whiskers at 10 and 18; West: 18 to 24 between 15 and 26.
    expect(diamonds(project({ series: [OUTLIER_DATA], inner: true }))).toHaveLength(3 + 6 + 4);
    const hidden = project({ series: [OUTLIER_DATA], outliers: false, inner: true });
    expect(diamonds(hidden)).toHaveLength(6 + 4);
  });

  test('hidden outliers leave the value axis to the whiskers and means', () => {
    const height = (projection: DrawingProjection) => {
      const [north] = boxes(projection);
      return north!.b - north!.t;
    };
    const shown = height(project({ series: [OUTLIER_DATA] }));
    const hidden = height(project({ series: [OUTLIER_DATA], outliers: false }));
    // From -60..100 to 0..30: the same box sixteen thirds as tall.
    expect(hidden / shown).toBeCloseTo(16 / 3, 3);
  });

  test('a category with one value draws a flat box at the value', () => {
    const projection = project({
      series: [
        pairs([
          ['One', [10]],
          ['Two', [6, 14]],
        ]),
      ],
    });
    const [one] = boxes(projection);
    expect(one!.b - one!.t).toBeCloseTo(0, 6);
  });
});

describe('several series', () => {
  const teams = [
    pairs([
      ['Q1', [12, 15, 18, 20, 22]],
      ['Q2', [14, 16, 19, 21, 24]],
    ]),
    pairs([
      ['Q1', [8, 11, 13, 16, 18]],
      ['Q2', [9, 10, 14, 15, 19]],
    ]),
    pairs([
      ['Q1', [16, 18, 21, 23, 25]],
      ['Q2', [2, 19, 22, 24, 27]],
    ]),
  ];

  test('series sit side by side, a tenth of a box apart, in their data colours', () => {
    const projection = project({ series: teams, gap: 1, legend: true });
    const painted = boxes(projection);
    const byColor = (hex: string) => painted.filter((shape) => shape.fill === hex);
    const [a, b, c] = [byColor('4472C4'), byColor('ED7D31'), byColor('A5A5A5')];
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(c).toHaveLength(2);
    const width = a[0]!.r - a[0]!.l;
    expect(b[0]!.l - a[0]!.r).toBeCloseTo(0.1 * width, 3);
    expect(c[0]!.l - b[0]!.r).toBeCloseTo(0.1 * width, 3);
    // The three boxes fill 98 % of the half slot a gap of 1 leaves.
    const slot = a[1]!.l - a[0]!.l;
    expect(c[0]!.r - a[0]!.l).toBeCloseTo((0.98 * slot) / 2, 2);
    expect(b[0]!.stroke).toBe('BE6427');
    expect(c[0]!.stroke).toBe('848484');
  });

  test('the legend lists each series with its fill and outline', () => {
    const projection = project({ series: teams, legend: true });
    const keys = shapes(projection).filter(
      (shape) => shape.fill && shape.r - shape.l < 8 && shape.r - shape.l > 6
    );
    expect(keys.map((key) => key.fill)).toEqual(['4472C4', 'ED7D31', 'A5A5A5']);
    expect(keys.map((key) => key.stroke)).toEqual(['365B9D', 'BE6427', '848484']);
  });
});

describe('series look', () => {
  test('a series outline of its own draws the boxes, whiskers and marks', () => {
    const projection = project({
      seriesSpPr:
        '<cx:spPr><a:solidFill><a:srgbClr val="B4C7E7"/></a:solidFill>' +
        '<a:ln w="19050"><a:solidFill><a:srgbClr val="203864"/></a:solidFill></a:ln></cx:spPr>',
    });
    const [box] = boxes(projection);
    expect(box!.fill).toBe('B4C7E7');
    expect(box!.stroke).toBe('203864');
    expect(box!.widthPt).toBeCloseTo(1.5, 6);
    expect(strokes(projection, '203864').length).toBeGreaterThan(3);
  });

  test('an outline of no fill draws no whiskers', () => {
    const projection = project({
      seriesSpPr: '<cx:spPr><a:ln><a:noFill/></a:ln></cx:spPr>',
    });
    expect(boxes(projection)[0]!.stroke).toBeNull();
    expect(shapes(projection).filter((shape) => !shape.fill && shape.stroke === '365B9D')).toEqual(
      []
    );
  });
});

describe('bounds', () => {
  test('a level past the point bound keeps the placeholder', () => {
    const projection = project({ ptCount: 1_000_000 });
    expect(projection.vectorShape ?? null).toBeNull();
  });
});

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Charts projected from their chart part: plot shapes, labels, refusal of unsupported content,
// no external loads, and memo identity.

import { describe, expect, test } from 'bun:test';
import {
  projectDrawingsInPackage,
  type DrawingProjection,
} from '../../../../core/src/store/package/drawing-projection.ts';
import type { OoxmlElement, OoxmlNode } from '../../../../core/src/store/package/ooxml-tree.ts';
import { autoValueScale } from '../chart-scale.ts';
import {
  CATEGORY_VALUE_AXES,
  chartPackage,
  chartSpace,
  numCache,
  series,
  strCache,
} from '../../../../core/src/store/__tests__/chart-fixture.ts';
import { installDrawing } from '../index.ts';

installDrawing();

const CATEGORIES = ['North', 'South', 'East', 'West'];

function project(chartXml: string, external = false): DrawingProjection {
  const projections = projectDrawingsInPackage(chartPackage(chartXml, { external }));
  expect(projections).toHaveLength(1);
  return projections[0]!;
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return (node as OoxmlElement).children.map(textOf).join('');
}

function labels(projection: DrawingProjection): string[] {
  return (projection.groupTextboxes ?? []).map((box) => textOf(box.story.content));
}

function fills(projection: DrawingProjection): (string | null)[] {
  return (projection.vectorShape?.components ?? []).map((component) => component.fillHex);
}

const unsupported = (projection: DrawingProjection) =>
  projection.diagnostics.filter((diagnostic) => diagnostic.code === 'unsupported-graphic');

describe('chart projection', () => {
  test('a clustered column chart paints its bars, axis labels, title and legend', () => {
    const plot =
      '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
      series(0, 'Alpha', CATEGORIES, [4.3, 2.5, 3.5, 4.5]) +
      series(1, 'Beta', CATEGORIES, [2.4, 4.4, 1.8, 2.8]) +
      '<c:gapWidth val="219"/><c:axId val="1"/><c:axId val="2"/></c:barChart>' +
      CATEGORY_VALUE_AXES;
    const projection = project(chartSpace(plot, { title: 'Totals', legend: 'b' }));
    expect(unsupported(projection)).toEqual([]);
    const texts = labels(projection);
    expect(texts).toContain('Totals');
    for (const category of CATEGORIES) expect(texts).toContain(category);
    for (const tick of ['0', '1', '2', '3', '4', '5']) expect(texts).toContain(tick);
    expect(texts).toContain('Alpha');
    expect(texts).toContain('Beta');
    // Eight bars and two legend keys in the theme's first two accents.
    const all = fills(projection);
    expect(all.filter((hex) => hex === '4472C4')).toHaveLength(5);
    expect(all.filter((hex) => hex === 'ED7D31')).toHaveLength(5);
  });

  test('a percent stacked chart labels its axis in percent', () => {
    const plot =
      '<c:barChart><c:barDir val="bar"/><c:grouping val="percentStacked"/>' +
      series(0, 'Alpha', CATEGORIES, [1, 2, 3, 4]) +
      series(1, 'Beta', CATEGORIES, [3, 2, 1, 0]) +
      '<c:overlap val="100"/><c:axId val="1"/><c:axId val="2"/></c:barChart>' +
      CATEGORY_VALUE_AXES;
    const texts = labels(project(chartSpace(plot)));
    expect(texts).toContain('0%');
    expect(texts).toContain('100%');
  });

  test('a pie paints one slice per point and its data labels', () => {
    const plot =
      '<c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>' +
      `<c:tx>${strCache(['Share'])}</c:tx>` +
      '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/>' +
      '<c:showSerName val="0"/><c:showPercent val="1"/></c:dLbls>' +
      `<c:cat>${strCache(CATEGORIES)}</c:cat><c:val>${numCache([2, 1, 1, 0])}</c:val></c:ser>` +
      '<c:firstSliceAng val="0"/></c:pieChart>';
    const projection = project(chartSpace(plot, { legend: 'r' }));
    const texts = labels(projection);
    expect(texts).toContain('50%');
    expect(texts.filter((text) => text === '25%')).toHaveLength(2);
    // A zero point paints no slice, though the legend still lists it.
    expect(texts).toContain('West');
    expect(fills(projection)).toContain('FFC000');
  });

  test('line and scatter series paint as open strokes', () => {
    const line =
      '<c:lineChart><c:grouping val="standard"/>' +
      series(0, 'Visits', CATEGORIES, [1, 3, 2, 4], '<c:marker><c:symbol val="none"/></c:marker>') +
      '<c:marker val="1"/><c:axId val="1"/><c:axId val="2"/></c:lineChart>' +
      CATEGORY_VALUE_AXES;
    const projection = project(chartSpace(line));
    const strokes = projection.vectorShape!.components.filter(
      (component) => component.strokeHex === '4472C4' && component.subpathsClosed?.[0] === false
    );
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.subpathsEmu[0]).toHaveLength(4);
  });

  test('an unsupported plot combination keeps the placeholder', () => {
    const plot =
      '<c:pieChart><c:varyColors val="1"/>' +
      series(0, 'Share', CATEGORIES, [1, 2, 3, 4]) +
      '</c:pieChart><c:barChart><c:barDir val="col"/>' +
      series(1, 'Alpha', CATEGORIES, [1, 2, 3, 4]) +
      '<c:axId val="1"/><c:axId val="2"/></c:barChart>' +
      CATEGORY_VALUE_AXES;
    const projection = project(chartSpace(plot));
    expect(projection.vectorShape).toBeNull();
    expect(unsupported(projection)).toHaveLength(1);
  });

  test('a radar chart closes each series round its spokes and labels the spokes', () => {
    const plot =
      '<c:radarChart><c:radarStyle val="marker"/>' +
      series(0, 'Plan', CATEGORIES, [4, 3, 5, 2]) +
      '<c:axId val="1"/><c:axId val="2"/></c:radarChart>' +
      CATEGORY_VALUE_AXES;
    const projection = project(chartSpace(plot));
    expect(unsupported(projection)).toEqual([]);
    const texts = labels(projection);
    for (const category of CATEGORIES) expect(texts).toContain(category);
    // Radar axes end at the data: no headroom past 5.
    expect(texts).toContain('5');
    expect(texts).not.toContain('6');
    const outline = projection.vectorShape!.components.find(
      (component) => component.strokeHex === '4472C4' && component.subpathsClosed?.[0] === true
    );
    expect(outline?.subpathsEmu[0]).toHaveLength(4);
  });

  test('bubbles grow with the square root of their size', () => {
    const plot =
      '<c:bubbleChart><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/>' +
      `<c:tx>${strCache(['Bubbles'])}</c:tx><c:xVal>${numCache([1, 2])}</c:xVal>` +
      `<c:yVal>${numCache([1, 2])}</c:yVal><c:bubbleSize>${numCache([1, 4])}</c:bubbleSize></c:ser>` +
      '<c:bubbleScale val="100"/><c:axId val="1"/><c:axId val="2"/></c:bubbleChart>' +
      '<c:valAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:valAx>' +
      '<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>';
    const projection = project(chartSpace(plot));
    const bubbles = projection.vectorShape!.components.find(
      (component) => component.fillHex === '4472C4'
    )!;
    const widths = bubbles.subpathsEmu.map((path) => {
      const xs = path.map((point) => point.x);
      return Math.max(...xs) - Math.min(...xs);
    });
    expect(widths[1]! / widths[0]!).toBeCloseTo(2, 1);
  });

  test('a bar-of-pie moves the last points into a stacked bar', () => {
    const plot =
      '<c:ofPieChart><c:ofPieType val="bar"/><c:varyColors val="1"/>' +
      '<c:ser><c:idx val="0"/><c:order val="0"/>' +
      `<c:tx>${strCache(['Share'])}</c:tx><c:cat>${strCache(['A', 'B', 'C', 'D', 'E'])}</c:cat>` +
      `<c:val>${numCache([40, 30, 15, 10, 5])}</c:val></c:ser>` +
      '<c:gapWidth val="100"/><c:secondPieSize val="75"/><c:serLines/></c:ofPieChart>';
    const projection = project(chartSpace(plot, { legend: 'b' }));
    expect(unsupported(projection)).toEqual([]);
    const rectangles = projection.vectorShape!.components.filter(
      (component) => component.subpathsEmu[0]!.length === 4 && component.fillHex !== null
    );
    // Three bar segments, five legend keys and the chart area.
    expect(rectangles.length).toBe(9);
  });

  test('stock charts join each category with a high-low line', () => {
    const plot =
      '<c:stockChart>' +
      series(0, 'High', CATEGORIES, [5, 6, 7, 8], '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>') +
      series(1, 'Low', CATEGORIES, [1, 2, 3, 4], '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>') +
      '<c:hiLowLines/><c:axId val="1"/><c:axId val="2"/></c:stockChart>' +
      CATEGORY_VALUE_AXES;
    const projection = project(chartSpace(plot));
    const hiLow = projection.vectorShape!.components.find(
      (component) => component.subpathsEmu.length === 4 && component.strokeHex === '000000'
    );
    expect(hiLow).toBeDefined();
  });

  test('a linear trendline fits the series and shows its equation', () => {
    const trend =
      '<c:trendline><c:trendlineType val="linear"/><c:dispRSqr val="1"/><c:dispEq val="1"/></c:trendline>';
    const plot =
      '<c:lineChart><c:grouping val="standard"/>' +
      series(0, 'Visits', CATEGORIES, [2, 4, 6, 8], trend) +
      '<c:axId val="1"/><c:axId val="2"/></c:lineChart>' +
      CATEGORY_VALUE_AXES;
    const texts = labels(project(chartSpace(plot, { legend: 'b' })));
    expect(texts.some((text) => text.includes('y = 2x'))).toBe(true);
    expect(texts.some((text) => text.includes('R² = 1'))).toBe(true);
    expect(texts).toContain('Linear (Visits)');
  });

  test('percentage error bars widen the value axis', () => {
    const bars =
      '<c:errBars><c:errDir val="y"/><c:errBarType val="both"/><c:errValType val="percentage"/>' +
      '<c:val val="50"/></c:errBars>';
    const plot =
      '<c:barChart><c:barDir val="col"/>' +
      series(0, 'Mean', CATEGORIES, [4, 4, 4, 4], bars) +
      '<c:axId val="1"/><c:axId val="2"/></c:barChart>' +
      CATEGORY_VALUE_AXES;
    // The bars reach 6, so the axis passes it.
    expect(labels(project(chartSpace(plot)))).toContain('7');
  });

  test('an external chart part is never loaded', () => {
    const plot =
      '<c:barChart><c:barDir val="col"/>' +
      series(0, 'Alpha', CATEGORIES, [1, 2, 3, 4]) +
      '<c:axId val="1"/><c:axId val="2"/></c:barChart>' +
      CATEGORY_VALUE_AXES;
    const projection = project(chartSpace(plot), true);
    expect(projection.vectorShape).toBeNull();
    expect(unsupported(projection)).toHaveLength(1);
  });

  test('file text reaches the label stories as text, never as markup', () => {
    const plot =
      '<c:barChart><c:barDir val="col"/>' +
      series(0, 'A &lt;w:r&gt; &amp; "q"', ['&lt;x/&gt;'], [1]) +
      '<c:axId val="1"/><c:axId val="2"/></c:barChart>' +
      CATEGORY_VALUE_AXES;
    const texts = labels(project(chartSpace(plot, { legend: 'r' })));
    expect(texts).toContain('A <w:r> & "q"');
    expect(texts).toContain('<x/>');
  });

  test('an unchanged chart projects the same label stories on every pass', () => {
    const plot =
      '<c:barChart><c:barDir val="col"/>' +
      series(0, 'Alpha', CATEGORIES, [1, 2, 3, 4]) +
      '<c:axId val="1"/><c:axId val="2"/></c:barChart>' +
      CATEGORY_VALUE_AXES;
    const pkg = chartPackage(chartSpace(plot));
    const first = projectDrawingsInPackage(pkg)[0]!;
    const second = projectDrawingsInPackage(pkg)[0]!;
    expect(second.groupTextboxes![0]!.story.content).toBe(first.groupTextboxes![0]!.story.content);
  });
});

describe('automatic value scale', () => {
  const scale = (dataMax: number, length = 200, dataMin = 0) =>
    autoValueScale({
      dataMin,
      dataMax,
      lengthPt: length,
      minIntervalPt: 15,
      fixedMin: null,
      fixedMax: null,
      fixedMajor: null,
    });

  test('the far end gets headroom and the unit leaves at most nine and a half units of data', () => {
    expect(scale(5)).toMatchObject({ min: 0, max: 6, major: 1 });
    expect(scale(4.5)).toMatchObject({ min: 0, max: 5, major: 0.5 });
    expect(scale(21)).toMatchObject({ min: 0, max: 25, major: 5 });
    expect(scale(48200)).toMatchObject({ min: 0, max: 60000, major: 10000 });
    expect(scale(25, 200, -18)).toMatchObject({ min: -25, max: 30, major: 5 });
  });

  test('a short axis takes fewer ticks', () => {
    expect(scale(4.5, 60).major).toBeGreaterThan(0.5);
  });
});

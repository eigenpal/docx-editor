// Charts projected from their chart part: plot shapes, labels, refusal of unsupported content,
// no external loads, and memo identity.

import { describe, expect, test } from 'bun:test';
import { projectDrawingsInPackage, type DrawingProjection } from '../package/drawing-projection.ts';
import type { OoxmlElement, OoxmlNode } from '../package/ooxml-tree.ts';
import { autoValueScale } from '../package/chart-scale.ts';
import {
  CATEGORY_VALUE_AXES,
  chartPackage,
  chartSpace,
  numCache,
  series,
  strCache,
} from './chart-fixture.ts';

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

  test('an unsupported chart type keeps the placeholder', () => {
    const plot =
      '<c:radarChart><c:radarStyle val="marker"/>' +
      series(0, 'Alpha', CATEGORIES, [1, 2, 3, 4]) +
      '<c:axId val="1"/><c:axId val="2"/></c:radarChart>' +
      CATEGORY_VALUE_AXES;
    const projection = project(chartSpace(plot));
    expect(projection.vectorShape).toBeNull();
    expect(unsupported(projection)).toHaveLength(1);
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

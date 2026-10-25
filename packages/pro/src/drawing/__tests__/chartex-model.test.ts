/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The chartex model reader: cached data by level and point index, series and axis settings,
// and the bounds that refuse a chart rather than paint part of it. Every value is
// file-derived, so counts, indexes, numbers and keys are all checked.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '../../../../core/src/store/package/ooxml-tree.ts';
import { waterfallChartSpace } from '../../../../core/src/store/__tests__/chartex-fixture.ts';
import { renderChartex } from '../chartex-render.ts';
import {
  CHARTEX_LIMITS,
  pointLabelVisibility,
  readChartexModel,
  seriesCategories,
  seriesValues,
} from '../chartex-model.ts';

const CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';

function parse(xml: string): OoxmlElement {
  const result = readOoxmlPart(xml, {
    name: '/word/charts/chartEx1.xml',
    contentType: 'application/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}

/** A chart space with `data` as its only data block and one waterfall series over it. */
function withData(data: string, series = ''): string {
  return (
    `<cx:chartSpace xmlns:cx="${CX}"><cx:chartData><cx:data id="0">${data}</cx:data></cx:chartData>` +
    '<cx:chart><cx:plotArea><cx:plotAreaRegion>' +
    (series || '<cx:series layoutId="waterfall"><cx:dataId val="0"/></cx:series>') +
    '</cx:plotAreaRegion></cx:plotArea></cx:chart></cx:chartSpace>'
  );
}

describe('reading', () => {
  test('dimensions, levels, series, axes, legend and labels', () => {
    const model = readChartexModel(
      parse(waterfallChartSpace({ title: 'Net', formatCode: '0.0%', subtotals: [0, 3] }))
    )!;
    expect(model).not.toBeNull();
    const series = model.series[0]!;
    expect(series.layoutId).toBe('waterfall');
    expect(series.name).toBe('Amount');
    expect(seriesCategories(series)).toEqual(['Start', 'Up', 'Down', 'End']);
    expect(seriesValues(series)).toEqual({ values: [100, 40, -30, 110], formatCode: '0.0%' });
    expect(model.axes.map((axis) => axis.kind)).toEqual(['category', 'value']);
    expect(model.axes[0]!.gapWidth).toBe(0.5);
    expect(model.axes[1]!.majorGridlines).not.toBeNull();
    expect(model.legend?.position).toBe('t');
    expect(model.title?.position).toBe('t');
    expect(series.dataLabels?.position).toBe('outEnd');
    expect(pointLabelVisibility(series.dataLabels!, 2)).toEqual({
      seriesName: false,
      categoryName: false,
      value: true,
    });
  });

  test('points are sparse by idx; out-of-range indexes and non-numbers read as no point', () => {
    const model = readChartexModel(
      parse(
        withData(
          '<cx:numDim type="val"><cx:lvl ptCount="4"><cx:pt idx="3">7</cx:pt>' +
            '<cx:pt idx="9">1</cx:pt><cx:pt idx="-1">2</cx:pt><cx:pt idx="0">1e400</cx:pt>' +
            '</cx:lvl></cx:numDim>'
        )
      )
    )!;
    expect(seriesValues(model.series[0]!)?.values).toEqual([null, null, null, 7]);
  });

  test('numeric categories take their level format', () => {
    const model = readChartexModel(
      parse(
        withData(
          '<cx:numDim type="cat"><cx:lvl ptCount="2" formatCode="0.0"><cx:pt idx="0">1</cx:pt>' +
            '<cx:pt idx="1">2.25</cx:pt></cx:lvl></cx:numDim>'
        )
      )
    )!;
    expect(seriesCategories(model.series[0]!)).toEqual(['1.0', '2.3']);
  });

  test('point label overrides and hidden labels', () => {
    const model = readChartexModel(
      parse(
        waterfallChartSpace({}).replace(
          '</cx:dataLabels>',
          '<cx:dataLabel idx="1"><cx:visibility categoryName="1"/></cx:dataLabel>' +
            '<cx:dataLabel idx="constructor"/><cx:dataLabelHidden idx="2"/></cx:dataLabels>'
        )
      )
    )!;
    const labels = model.series[0]!.dataLabels!;
    expect(pointLabelVisibility(labels, 1)?.categoryName).toBe(true);
    expect(pointLabelVisibility(labels, 2)).toBeNull();
    expect(labels.points.size).toBe(1);
  });
});

describe('bounds', () => {
  const level = (count: string, points = '') =>
    withData(`<cx:numDim type="val"><cx:lvl ptCount="${count}">${points}</cx:lvl></cx:numDim>`);

  test('a level without a valid point count refuses the chart', () => {
    expect(readChartexModel(parse(level('')))).toBeNull();
    expect(readChartexModel(parse(level('-3')))).toBeNull();
    expect(readChartexModel(parse(level('1e3')))).toBeNull();
  });

  test('a point count past the bound refuses the chart before allocating', () => {
    expect(readChartexModel(parse(level(String(CHARTEX_LIMITS.pointsPerLevel + 1))))).toBeNull();
    expect(readChartexModel(parse(level('999999999')))).toBeNull();
  });

  test('more points than the count names refuses the chart', () => {
    expect(
      readChartexModel(parse(level('1', '<cx:pt idx="0">1</cx:pt><cx:pt idx="0">2</cx:pt>')))
    ).toBeNull();
  });

  test('levels past the total point budget refuse the chart', () => {
    const levels = Array.from(
      { length: 9 },
      () => `<cx:lvl ptCount="${CHARTEX_LIMITS.pointsPerLevel}"/>`
    ).join('');
    const dims = Array.from({ length: 2 }, () => `<cx:numDim type="val">${levels}</cx:numDim>`);
    expect(readChartexModel(parse(withData(dims.join(''))))).toBeNull();
  });

  test('too many series refuse the chart', () => {
    const many = Array.from(
      { length: CHARTEX_LIMITS.series + 1 },
      () => '<cx:series layoutId="waterfall"><cx:dataId val="0"/></cx:series>'
    ).join('');
    expect(readChartexModel(parse(withData('', many)))).toBeNull();
  });

  test('a chart without a plot area region or series is no chart', () => {
    expect(
      readChartexModel(parse(`<cx:chartSpace xmlns:cx="${CX}"><cx:chart/></cx:chartSpace>`))
    ).toBeNull();
    const empty = withData('').replace(/<cx:series.*<\/cx:series>/, '');
    expect(readChartexModel(parse(empty))).toBeNull();
  });
});

describe('file-derived keys', () => {
  test('a data id or layout id naming an object member resolves nothing', () => {
    for (const key of ['__proto__', 'constructor', 'toString']) {
      const xml = waterfallChartSpace({ layoutId: key }).replace(
        '<cx:dataId val="0"/>',
        `<cx:dataId val="${key}"/>`
      );
      const model = readChartexModel(parse(xml))!;
      expect(model.series[0]!.data).toBeNull();
      expect(renderChartex(model, { style: null, colors: null }, 400, 250)).toBeNull();
    }
  });

  test('a chart of an unsupported layout renders nothing', () => {
    const model = readChartexModel(parse(waterfallChartSpace({ layoutId: 'regionMap' })))!;
    expect(renderChartex(model, { style: null, colors: null }, 400, 250)).toBeNull();
  });
});

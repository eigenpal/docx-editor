/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { projectDrawingsInPackage } from '../../../../core/src/store/package/drawing-projection.ts';
import {
  CATEGORY_VALUE_AXES,
  chartPackage,
  chartSpace,
  series,
} from '../../../../core/src/store/__tests__/chart-fixture.ts';
import { installDrawing } from '../index.ts';
import { slice } from '../chart-scene.ts';

installDrawing();

test('slice geometry bounds its angular work before allocating points', () => {
  expect(() => slice(0, 0, 10, 0, 0, Infinity)).toThrow(RangeError);
  expect(() => slice(0, 0, 10, 0, 0, 1e308)).toThrow(RangeError);
  expect(slice(0, 0, 10, 0, 0, 360)).toHaveLength(181);
});

function project(plot: string) {
  return projectDrawingsInPackage(chartPackage(chartSpace(plot + CATEGORY_VALUE_AXES)))[0]!;
}

function columnSeries(source: string) {
  return (
    '<c:barChart><c:barDir val="col"/>' + source + '<c:axId val="1"/><c:axId val="2"/></c:barChart>'
  );
}

function expectRefused(plot: string) {
  const drawing = project(plot);
  expect(drawing.vectorShape === null).toBe(true);
  expect(drawing.diagnostics.some((item) => item.code === 'unsupported-graphic')).toBe(true);
}

test('a cache count beyond the per-series limit refuses the chart', () => {
  const source = series(0, 'Values', ['A', 'B'], [2, 4]).replaceAll(
    '<c:ptCount val="2"/>',
    '<c:ptCount val="4097"/>'
  );
  expectRefused(columnSeries(source));
});

test('a cache point beyond the per-series limit refuses the chart', () => {
  const source = series(0, 'Values', ['A', 'B'], [2, 4]).replaceAll(
    '<c:pt idx="1">',
    '<c:pt idx="4096">'
  );
  expectRefused(columnSeries(source));
});

test('multi-level category padding counts against the whole-chart limit', () => {
  const categories =
    '<c:cat><c:multiLvlStrRef><c:multiLvlStrCache>' +
    '<c:ptCount val="4096"/><c:lvl><c:pt idx="0"><c:v>A</c:v></c:pt></c:lvl>' +
    '</c:multiLvlStrCache></c:multiLvlStrRef></c:cat>';
  const source = Array.from(
    { length: 8 },
    (_, index) =>
      `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${categories}` +
      '<c:val><c:numLit><c:ptCount val="1"/><c:pt idx="0"><c:v>2</c:v></c:pt></c:numLit></c:val></c:ser>'
  ).join('');
  expectRefused(columnSeries(source));
});

test('the last bubble cache counts against the whole-chart limit', () => {
  const cache = '<c:numLit><c:ptCount val="4096"/><c:pt idx="0"><c:v>2</c:v></c:pt></c:numLit>';
  const source = Array.from(
    { length: 3 },
    (_, index) =>
      `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>` +
      `<c:xVal>${cache}</c:xVal><c:yVal>${cache}</c:yVal><c:bubbleSize>${cache}</c:bubbleSize></c:ser>`
  ).join('');
  expectRefused('<c:bubbleChart>' + source + '<c:axId val="1"/><c:axId val="2"/></c:bubbleChart>');
});

test('sparse caches at the per-series limit still render', () => {
  const source = series(0, 'Values', ['A', 'B'], [2, 4]).replaceAll(
    '<c:ptCount val="2"/>',
    '<c:ptCount val="4096"/>'
  );
  const drawing = project(columnSeries(source));
  expect(drawing.vectorShape !== null).toBe(true);
  expect(drawing.diagnostics).toEqual([]);
});

test('a missing cache count still infers the length from point indices', () => {
  const source = series(0, 'Values', ['A', 'B'], [2, 4]).replaceAll('<c:ptCount val="2"/>', '');
  expect(project(columnSeries(source)).vectorShape !== null).toBe(true);
});

test('points outside the authored cache count refuse the chart instead of disappearing', () => {
  const source = series(0, 'Values', ['A', 'B'], [2, 4]).replaceAll(
    '<c:ptCount val="2"/>',
    '<c:ptCount val="1"/>'
  );
  expectRefused(columnSeries(source));
});

test('multi-level categories outside the authored count refuse the chart', () => {
  const source =
    '<c:ser><c:idx val="0"/><c:order val="0"/>' +
    '<c:cat><c:multiLvlStrRef><c:multiLvlStrCache><c:ptCount val="1"/>' +
    '<c:lvl><c:pt idx="1"><c:v>B</c:v></c:pt></c:lvl></c:multiLvlStrCache></c:multiLvlStrRef></c:cat>' +
    '<c:val><c:numLit><c:ptCount val="2"/><c:pt idx="1"><c:v>4</c:v></c:pt></c:numLit></c:val></c:ser>';
  expectRefused(columnSeries(source));
});

test('invalid unsigned cache counts refuse the chart', () => {
  for (const count of ['', '1.5', '1e2', '0x10', '-1']) {
    const source = series(0, 'Values', ['A', 'B'], [2, 4]).replaceAll(
      '<c:ptCount val="2"/>',
      `<c:ptCount val="${count}"/>`
    );
    expectRefused(columnSeries(source));
  }
});

test('numeric overflow refuses the chart instead of emitting invalid coordinates', () => {
  expectRefused(columnSeries(series(0, 'Values', ['A', 'B'], [-1e308, 1e308])));
});

test('overflowing totals refuse pie, doughnut, and split-pie charts', () => {
  for (const kind of ['pieChart', 'pie3DChart', 'doughnutChart', 'ofPieChart']) {
    const source = `<c:${kind}>` + series(0, 'Values', ['A', 'B'], [1e308, 1e308]) + `</c:${kind}>`;
    expectRefused(source);
  }
});

test('non-finite label positions refuse a chart even when its axes and bars have no paint', () => {
  const plot = columnSeries(
    series(
      0,
      'Values',
      ['A', 'B'],
      [-1e308, 1e308],
      '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>'
    )
  );
  const axes = CATEGORY_VALUE_AXES.replace('<c:majorGridlines/>', '').replaceAll(
    '<c:crossAx',
    '<c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:crossAx'
  );
  const drawing = projectDrawingsInPackage(chartPackage(chartSpace(plot + axes)))[0]!;
  expect(drawing.vectorShape === null).toBe(true);
  expect(drawing.diagnostics.some((item) => item.code === 'unsupported-graphic')).toBe(true);
});

// A chart that does not paint carries its title and plot types, so its placeholder and a host
// component replacing it can name the chart.

import { expect, test } from 'bun:test';
import { projectDrawingsInPackage } from '../package/drawing-projection.ts';
import { drawingRenderers } from '../package/drawing-renderers.ts';
import { CATEGORY_VALUE_AXES, chartPackage, chartSpace, series } from './chart-fixture.ts';

const BAR =
  '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>' +
  series(0, 'One', ['A', 'B'], [1, 2]) +
  '<c:axId val="1"/><c:axId val="2"/></c:barChart>';
const LINE =
  '<c:lineChart><c:grouping val="standard"/>' +
  series(1, 'Two', ['A', 'B'], [3, 4]) +
  '<c:axId val="1"/><c:axId val="2"/></c:lineChart>';

test('an unpainted chart carries its title and plot types', () => {
  expect(drawingRenderers().chart).toBeUndefined();
  const [projection] = projectDrawingsInPackage(
    chartPackage(chartSpace(BAR + LINE + CATEGORY_VALUE_AXES, { title: 'Revenue  by\nquarter' }))
  );
  expect(projection!.chartSummary).toEqual({
    title: 'Revenue by quarter',
    plotTypes: ['bar', 'line'],
  });
});

test('a chart without a title has a null title', () => {
  const [projection] = projectDrawingsInPackage(
    chartPackage(chartSpace(BAR + CATEGORY_VALUE_AXES))
  );
  expect(projection!.chartSummary).toEqual({ title: null, plotTypes: ['bar'] });
});

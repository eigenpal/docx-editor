/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A pie draws only its first series, so its legend lists that series' categories with any
// number of series and whether or not its points vary (`c:varyColors`, 21.2.2.227). Every
// ring of a doughnut with varied points takes the same colour per point, and its legend lists
// the categories; without varied points the legend lists the series. A bar plot with several
// series keeps a legend entry per series.

import { describe, expect, test } from 'bun:test';
import {
  projectDrawingsInPackage,
  type DrawingProjection,
} from '../../../../core/src/store/package/drawing-projection.ts';
import type { OoxmlElement, OoxmlNode } from '../../../../core/src/store/package/ooxml-tree.ts';
import {
  CATEGORY_VALUE_AXES,
  chartPackage,
  chartSpace,
  series,
} from '../../../../core/src/store/__tests__/chart-fixture.ts';
import { installDrawing } from '../index.ts';

installDrawing();

const CATEGORIES = ['Apple', 'Pear', 'Plum'];
const TWO_SERIES =
  series(0, 'First', CATEGORIES, [5, 3, 2]) + series(1, 'Second', CATEGORIES, [1, 1, 8]);

function project(plot: string): DrawingProjection {
  const projections = projectDrawingsInPackage(chartPackage(chartSpace(plot, { legend: 'r' })));
  expect(projections).toHaveLength(1);
  return projections[0]!;
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return (node as OoxmlElement).children.map(textOf).join('');
}

const labels = (projection: DrawingProjection) =>
  (projection.groupTextboxes ?? []).map((box) => textOf(box.story.content));

const fills = (projection: DrawingProjection) =>
  new Set((projection.vectorShape?.components ?? []).map((component) => component.fillHex));

const vary = (on: boolean) => `<c:varyColors val="${on ? 1 : 0}"/>`;

describe('pie and doughnut legends with several series', () => {
  for (const kind of ['pieChart', 'pie3DChart']) {
    test(`a ${kind} with varied points lists the categories in point colours`, () => {
      const projection = project(`<c:${kind}>${vary(true)}${TWO_SERIES}</c:${kind}>`);
      expect(labels(projection)).toEqual(CATEGORIES);
      expect(fills(projection)).toContain('ED7D31');
      expect(fills(projection)).toContain('A5A5A5');
    });
  }

  test('a pie without varied points lists the categories in the series colour', () => {
    for (const plot of [TWO_SERIES, series(0, 'First', CATEGORIES, [5, 3, 2])]) {
      const projection = project(`<c:pieChart>${vary(false)}${plot}</c:pieChart>`);
      expect(labels(projection)).toEqual(CATEGORIES);
      expect(fills(projection)).not.toContain('ED7D31');
    }
  });

  test('a doughnut lists the categories only when its points vary', () => {
    const doughnut = (on: boolean) =>
      project(`<c:doughnutChart>${vary(on)}${TWO_SERIES}<c:holeSize val="50"/></c:doughnutChart>`);
    const varied = doughnut(true);
    expect(labels(varied)).toEqual(CATEGORIES);
    expect(fills(varied)).toContain('A5A5A5');
    expect(labels(doughnut(false))).toEqual(['First', 'Second']);
  });

  test('a bar plot with several series keeps one entry per series', () => {
    const projection = project(
      `<c:barChart><c:barDir val="col"/>${vary(true)}${TWO_SERIES}` +
        `<c:axId val="1"/><c:axId val="2"/></c:barChart>${CATEGORY_VALUE_AXES}`
    );
    expect(labels(projection).filter((text) => text === 'First' || text === 'Second')).toEqual([
      'First',
      'Second',
    ]);
  });
});

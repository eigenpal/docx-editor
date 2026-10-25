/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A logarithmic value axis (`c:logBase`) places values by their logarithm, with a tick at
// each power of the base.

import { expect, test } from 'bun:test';
import { projectDrawingsInPackage } from '../../../../core/src/store/package/drawing-projection.ts';
import type { OoxmlElement, OoxmlNode } from '../../../../core/src/store/package/ooxml-tree.ts';
import {
  CATEGORY_VALUE_AXES,
  chartPackage,
  chartSpace,
  series,
} from '../../../../core/src/store/__tests__/chart-fixture.ts';
import { logValueScale, scaleRatio } from '../chart-scale.ts';
import { installDrawing } from '../index.ts';

installDrawing();

test('a logarithmic scale spans whole powers and places powers evenly', () => {
  const scale = logValueScale(3, 420, 10, null, null);
  expect(scale.min).toBe(1);
  expect(scale.max).toBe(1000);
  expect(scale.ticks).toEqual([1, 10, 100, 1000]);
  expect(scaleRatio(scale, 10)).toBeCloseTo(1 / 3, 9);
  expect(scaleRatio(scale, 100)).toBeCloseTo(2 / 3, 9);
  // A value at or below zero has no place on the axis and sits at the minimum.
  expect(scaleRatio(scale, 0)).toBe(0);
  expect(scaleRatio(scale, -5)).toBe(0);
});

test('fixed positive ends win, and base 2 ticks double', () => {
  const scale = logValueScale(3, 40, 2, 2, 64);
  expect(scale.ticks).toEqual([2, 4, 8, 16, 32, 64]);
});

const LINE =
  '<c:lineChart><c:grouping val="standard"/>' +
  series(0, 'Growth', ['A', 'B', 'C'], [1, 10, 100]) +
  '<c:axId val="1"/><c:axId val="2"/></c:lineChart>';

function labelTexts(xml: string): string[] {
  const [projection] = projectDrawingsInPackage(chartPackage(xml));
  const text = (node: OoxmlNode): string =>
    node.kind === 'textValue' ? node.value : (node as OoxmlElement).children.map(text).join('');
  return (projection!.groupTextboxes ?? []).map((box) => text(box.story.content));
}

test('a line chart on a logarithmic axis labels the powers, not linear steps', () => {
  const logAxes = CATEGORY_VALUE_AXES.replace(
    '<c:valAx><c:axId val="2"/><c:scaling>',
    '<c:valAx><c:axId val="2"/><c:scaling><c:logBase val="10"/>'
  );
  const log = labelTexts(chartSpace(LINE + logAxes));
  for (const tick of ['1', '10', '100']) expect(log).toContain(tick);
  expect(log).not.toContain('20');
  const linear = labelTexts(chartSpace(LINE + CATEGORY_VALUE_AXES));
  expect(linear).toContain('20');
});

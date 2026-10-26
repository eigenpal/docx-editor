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

installDrawing();

function bars(varyColors: boolean, seriesFill: string) {
  const plot =
    `<c:barChart><c:barDir val="col"/><c:varyColors val="${varyColors ? 1 : 0}"/>` +
    series(
      0,
      'Values',
      ['A', 'B'],
      [2, 4],
      seriesFill +
        '<c:dPt><c:idx val="1"/><c:spPr><a:ln><a:solidFill>' +
        '<a:srgbClr val="123456"/></a:solidFill></a:ln></c:spPr></c:dPt>'
    ) +
    '<c:axId val="1"/><c:axId val="2"/></c:barChart>' +
    CATEGORY_VALUE_AXES;
  return projectDrawingsInPackage(chartPackage(chartSpace(plot)))[0]!.vectorShape!.components;
}

test('a point outline preserves the authored series fill', () => {
  const components = bars(
    false,
    '<c:spPr><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></c:spPr>'
  );
  expect(components.filter((component) => component.fillHex === 'ABCDEF')).toHaveLength(2);
  expect(components.find((component) => component.strokeHex === '123456')?.fillHex).toBe('ABCDEF');
});

test('a point outline preserves the automatic series color when colors do not vary', () => {
  const components = bars(false, '');
  expect(components.filter((component) => component.fillHex === '4472C4')).toHaveLength(2);
  expect(components.find((component) => component.strokeHex === '123456')?.fillHex).toBe('4472C4');
});

test('a point outline keeps its point color when colors vary', () => {
  const components = bars(true, '');
  expect(components.find((component) => component.strokeHex === '123456')?.fillHex).toBe('ED7D31');
});

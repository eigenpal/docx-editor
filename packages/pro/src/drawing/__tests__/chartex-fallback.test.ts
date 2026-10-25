/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// With the drawing module installed, a chartex chart in `mc:AlternateContent` renders when the
// module supports its type. A type the module does not draw shows its fallback picture, and
// without a fallback that paints it keeps the labelled chart placeholder with its summary.

import { expect, test } from 'bun:test';
import { drawingPaintFields } from '../../../../core/src/layout/drawing-paint-fields.ts';
import { projectDrawingsInPackage } from '../../../../core/src/store/package/drawing-projection.ts';
import {
  chartexPackage,
  waterfallChartSpace,
} from '../../../../core/src/store/__tests__/chartex-fixture.ts';
import { installDrawing } from '../index.ts';

installDrawing();

test('a supported chart renders from its Choice', () => {
  const [projection] = projectDrawingsInPackage(
    chartexPackage(waterfallChartSpace(), { alternateContent: true })
  );
  expect(projection!.picture).toBeNull();
  expect(projection!.vectorShape).not.toBeNull();
});

test('an unsupported chart type shows its fallback picture', () => {
  const [projection] = projectDrawingsInPackage(
    chartexPackage(waterfallChartSpace({ layoutId: 'treemap' }), { alternateContent: true })
  );
  expect(projection!.picture?.embeddedRelationshipId).toBe('rId11');
  expect(projection!.vectorShape).toBeNull();
});

test('an unsupported chart type without a fallback keeps the placeholder', () => {
  const [projection] = projectDrawingsInPackage(
    chartexPackage(waterfallChartSpace({ layoutId: 'treemap', title: 'Sales' }), {
      alternateContent: true,
      emptyFallback: true,
    })
  );
  expect(projection!.picture).toBeNull();
  expect(drawingPaintFields(projection!).placeholderGraphicKind).toBe('chart');
  expect(projection!.chartSummary).toEqual({
    title: 'Sales',
    plotTypes: ['treemap'],
    shownAs: 'placeholder',
  });
});

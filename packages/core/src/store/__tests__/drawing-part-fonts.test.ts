// Faces that chart parts name for their labels, outside every document story.

import { expect, test } from 'bun:test';
import { drawingPartFontFamilies } from '../package/drawing-part-fonts.ts';
import { CATEGORY_VALUE_AXES, chartPackage, chartSpace, series } from './chart-fixture.ts';

test('chart parts name their faces and theme tokens resolve to the theme faces', () => {
  const plot =
    '<c:barChart><c:barDir val="col"/>' +
    series(0, 'Alpha', ['A'], [1]) +
    '<c:axId val="1"/><c:axId val="2"/></c:barChart>' +
    CATEGORY_VALUE_AXES;
  const xml = chartSpace(plot).replace(
    '</c:chartSpace>',
    '<c:txPr><a:bodyPr/><a:p><a:pPr><a:defRPr><a:latin typeface="Georgia"/>' +
      '<a:ea typeface="+mj-ea"/></a:defRPr></a:pPr></a:p></c:txPr></c:chartSpace>'
  );
  const families = drawingPartFontFamilies(chartPackage(xml), {
    major: 'Major Face',
    minor: 'Minor Face',
  });
  expect(families).toEqual(['Minor Face', 'Georgia', 'Major Face']);
});

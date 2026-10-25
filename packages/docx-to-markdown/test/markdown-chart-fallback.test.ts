// Markdown export has no chart renderer. A chart in `mc:AlternateContent` exports its saved
// fallback picture, with the chart title as its alt text, and a chart without a fallback that
// paints exports no image and gets an `omitted-drawing` warning that names it. The drawing
// module is not installed in this process; `markdown-chart-fallback-drawing.test.ts` repeats
// the cases with it installed.

import { expect, test } from 'bun:test';
import { createFixedMeasurer } from '@docx-editor.dev/core/layout';
import { drawingRenderers } from '../../core/src/store/package/drawing-renderers.ts';
import {
  chartexDocx,
  waterfallChartSpace,
} from '../../core/src/store/__tests__/chartex-fixture.ts';
import { exportMarkdown } from '../src/index.ts';

const options = { measurer: createFixedMeasurer(), images: true } as const;

test('the drawing module is not installed in this process', () => {
  expect(drawingRenderers().chart).toBeUndefined();
});

test('a wrapped chart exports its fallback picture', async () => {
  const bytes = chartexDocx(waterfallChartSpace(), { alternateContent: true });
  const result = await exportMarkdown(bytes, options);
  expect(result.media).toHaveLength(1);
  expect(result.markdown).toMatch(/^!\[\]\(media\/[0-9a-f]+\.png\)$/);
  expect(result.warnings).toEqual([]);
});

test('the fallback picture takes the chart title as its alt text', async () => {
  const bytes = chartexDocx(waterfallChartSpace({ title: 'Net cash' }), {
    alternateContent: true,
  });
  const result = await exportMarkdown(bytes, options);
  expect(result.markdown).toMatch(/^!\[Net cash\]\(media\/[0-9a-f]+\.png\)$/);
  expect(result.media[0]!.occurrences[0]).toMatchObject({ alt: 'Net cash', decorative: false });
});

test('a wrapped chart without a fallback picture exports no image', async () => {
  const bytes = chartexDocx(waterfallChartSpace({ title: 'Net cash' }), {
    alternateContent: true,
    emptyFallback: true,
  });
  const result = await exportMarkdown(bytes, options);
  expect(result.media).toHaveLength(0);
  const warning = result.warnings.find((entry) => entry.code === 'omitted-drawing');
  expect(warning?.message).toBe(
    'The chart "Net cash" has no fallback picture and is omitted from Markdown.'
  );
});

test('an untitled chart without a fallback picture gets a chart warning', async () => {
  const bytes = chartexDocx(waterfallChartSpace({ title: null }));
  const result = await exportMarkdown(bytes, options);
  const warning = result.warnings.find((entry) => entry.code === 'omitted-drawing');
  expect(warning?.message).toBe('A chart without a fallback picture is omitted from Markdown.');
});

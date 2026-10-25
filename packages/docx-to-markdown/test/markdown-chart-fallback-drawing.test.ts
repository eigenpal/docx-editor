// With the drawing module installed in the process, the editor and PDF export draw the chart,
// but Markdown cannot use a drawn chart: a chart in `mc:AlternateContent` still exports its
// saved fallback picture with the chart title as alt text, and a chart without one still gets
// its named `omitted-drawing` warning.

import { expect, test } from 'bun:test';
import { createFixedMeasurer } from '@docx-editor.dev/core/layout';
import { drawingRenderers } from '../../core/src/store/package/drawing-renderers.ts';
import {
  chartexDocx,
  waterfallChartSpace,
} from '../../core/src/store/__tests__/chartex-fixture.ts';
import { installDrawing } from '../../pro/src/drawing/index.ts';
import { exportMarkdown } from '../src/index.ts';

installDrawing();

const options = { measurer: createFixedMeasurer(), images: true } as const;

test('the drawing module is installed in this process', () => {
  expect(drawingRenderers().chart).toBeDefined();
});

test('a wrapped chart exports its fallback picture with the chart title', async () => {
  const bytes = chartexDocx(waterfallChartSpace({ title: 'Net cash' }), {
    alternateContent: true,
  });
  const result = await exportMarkdown(bytes, options);
  expect(result.media).toHaveLength(1);
  expect(result.markdown).toMatch(/^!\[Net cash\]\(media\/[0-9a-f]+\.png\)$/);
  expect(result.warnings).toEqual([]);
});

test('a wrapped chart without a fallback picture keeps the named warning', async () => {
  const bytes = chartexDocx(waterfallChartSpace({ title: 'Net cash' }), {
    alternateContent: true,
    emptyFallback: true,
  });
  const result = await exportMarkdown(bytes, options);
  expect(result.media).toHaveLength(0);
  expect(result.warnings.map((warning) => warning.message)).toContain(
    'The chart "Net cash" has no fallback picture and is omitted from Markdown.'
  );
});

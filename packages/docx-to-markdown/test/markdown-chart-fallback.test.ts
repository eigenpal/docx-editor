// Markdown export has no chart renderer. A chart in `mc:AlternateContent` exports its fallback
// picture, and a chart without a fallback that paints exports no image.

import { expect, test } from 'bun:test';
import { createFixedMeasurer } from '@docx-editor.dev/core/layout';
import {
  chartexDocx,
  waterfallChartSpace,
} from '../../core/src/store/__tests__/chartex-fixture.ts';
import { exportMarkdown } from '../src/index.ts';

const options = { measurer: createFixedMeasurer(), images: true } as const;

test('a wrapped chart exports its fallback picture', async () => {
  const bytes = chartexDocx(waterfallChartSpace(), { alternateContent: true });
  const result = await exportMarkdown(bytes, options);
  expect(result.media).toHaveLength(1);
  expect(result.markdown).toMatch(/^!\[\]\(media\/[0-9a-f]+\.png\)$/);
  expect(result.warnings).toEqual([]);
});

test('a wrapped chart without a fallback picture exports no image', async () => {
  const bytes = chartexDocx(waterfallChartSpace(), {
    alternateContent: true,
    emptyFallback: true,
  });
  const result = await exportMarkdown(bytes, options);
  expect(result.media).toHaveLength(0);
  expect(result.warnings.map((warning) => warning.code)).toContain('omitted-drawing');
});

// With the drawing module installed in the process, the session draws the chart, as the
// editor and PDF export do, and Markdown still exports the picture saved in the chart's
// fallback, with the same alt text and warning rules as without the module. There is no
// Markdown-only session mode: the same session serves PDF with the drawn chart.

import { expect, test } from 'bun:test';
import { createFixedMeasurer, forEachSemanticDrawing } from '@docx-editor.dev/core/layout';
import { drawingRenderers } from '../../core/src/store/package/drawing-renderers.ts';
import {
  chartexDocx,
  classicBarChartSpace,
  waterfallChartSpace,
} from '../../core/src/store/__tests__/chartex-fixture.ts';
import { installDrawing } from '../../pro/src/drawing/index.ts';
import { exportMarkdown, exportMarkdownFrom, openDocumentForExport } from '../src/index.ts';

installDrawing();

const options = { measurer: createFixedMeasurer(), images: true } as const;

test('the drawing module is installed in this process', () => {
  expect(drawingRenderers().chart).toBeDefined();
});

for (const classic of [false, true]) {
  test(`${classic ? 'classic' : 'chartex'}: a drawn chart exports its fallback picture`, async () => {
    const bytes = chartexDocx(
      classic ? classicBarChartSpace('Net cash') : waterfallChartSpace({ title: 'Net cash' }),
      { classic, alternateContent: true }
    );
    const opened = await openDocumentForExport(bytes, { measurer: createFixedMeasurer() });
    if (!opened.ok) throw new Error(opened.reason);
    try {
      const shown: string[] = [];
      forEachSemanticDrawing(await opened.session.layout(), ({ drawing }) => {
        shown.push(drawing.chart!.shownAs);
        expect(drawing.vectorShape).not.toBeNull();
        expect(drawing.chartFallbackResource?.kind).toBe('ready');
      });
      expect(shown).toEqual(['chart']);
      const result = await exportMarkdownFrom(opened.session, { images: true });
      expect(result.media).toHaveLength(1);
      expect(result.markdown).toMatch(/^!\[Net cash\]\(media\/[0-9a-f]+\.png\)$/);
      expect(result.warnings).toEqual([]);
    } finally {
      opened.session.dispose();
    }
  });
}

test('a drawn chart without a fallback picture gets the same warning', async () => {
  const bytes = chartexDocx(waterfallChartSpace({ title: 'Net cash' }), {
    alternateContent: true,
    emptyFallback: true,
  });
  const result = await exportMarkdown(bytes, options);
  expect(result.media).toHaveLength(0);
  expect(result.warnings.map((warning) => warning.message)).toContain(
    'The chart "Net cash" is omitted from Markdown because it has no saved fallback picture.'
  );
});

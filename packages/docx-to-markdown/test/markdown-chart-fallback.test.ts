// Markdown exports a chart as the picture saved in its `mc:AlternateContent` fallback. Its
// alt text is the author's description on the drawing, then the chart title; a chart picture
// with neither is decorative. A chart that exports no picture gets an `omitted-drawing`
// warning that says why, and a page with many such charts gets a capped list of warnings.
// The drawing module is not installed in this process; `markdown-chart-fallback-drawing.test.ts`
// repeats the main cases with it installed.

import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createFixedMeasurer } from '@docx-editor.dev/core/layout';
import { drawingRenderers } from '../../core/src/store/package/drawing-renderers.ts';
import {
  chartexDocx,
  waterfallChartSpace,
  type ChartexDocxOptions,
} from '../../core/src/store/__tests__/chartex-fixture.ts';
import { exportMarkdown } from '../src/index.ts';
import { MAX_CHART_WARNINGS_PER_PAGE } from '../src/markdown-warnings.ts';

const options = { measurer: createFixedMeasurer(), images: true } as const;

/** The chart fixture with `edit` applied to its files. */
function edited(
  title: string | null,
  fixture: ChartexDocxOptions,
  edit: (files: Record<string, Uint8Array>, document: string) => string
): Uint8Array {
  const files = unzipSync(chartexDocx(waterfallChartSpace({ title }), fixture));
  files['word/document.xml'] = strToU8(edit(files, strFromU8(files['word/document.xml']!)));
  return zipSync(files);
}

function chartWarnings(result: { readonly warnings: readonly { message: string }[] }): string[] {
  return result.warnings
    .map((warning) => warning.message)
    .filter((message) => message.includes('chart'));
}

test('the drawing module is not installed in this process', () => {
  expect(drawingRenderers().chart).toBeUndefined();
});

test('an untitled chart exports its fallback picture as a decorative image', async () => {
  const bytes = chartexDocx(waterfallChartSpace({ title: null }), { alternateContent: true });
  const result = await exportMarkdown(bytes, options);
  expect(result.media).toHaveLength(1);
  expect(result.markdown).toMatch(/^!\[\]\(media\/[0-9a-f]+\.png\)$/);
  expect(result.media[0]!.occurrences[0]).toMatchObject({ alt: '', decorative: true });
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

test("the author's description on the chart comes before the chart title", async () => {
  const bytes = edited('Net cash', { alternateContent: true }, (_files, document) =>
    document.replace(
      '<wp:docPr id="1" name="Chart 1"/>',
      '<wp:docPr id="1" name="Chart 1" descr="Cash by quarter"/>'
    )
  );
  const result = await exportMarkdown(bytes, options);
  expect(result.markdown).toMatch(/^!\[Cash by quarter\]\(media\/[0-9a-f]+\.png\)$/);
});

test('a chart without a fallback says it has no saved fallback picture', async () => {
  const bytes = chartexDocx(waterfallChartSpace({ title: 'Net cash' }), {
    alternateContent: true,
    emptyFallback: true,
  });
  const result = await exportMarkdown(bytes, options);
  expect(result.media).toHaveLength(0);
  expect(chartWarnings(result)).toEqual([
    'The chart "Net cash" is omitted from Markdown because it has no saved fallback picture.',
  ]);
  const untitled = await exportMarkdown(chartexDocx(waterfallChartSpace({ title: null })), options);
  expect(chartWarnings(untitled)).toEqual([
    'A chart is omitted from Markdown because it has no saved fallback picture.',
  ]);
});

test('with image export off, a chart with a fallback picture says so', async () => {
  const bytes = chartexDocx(waterfallChartSpace({ title: 'Net cash' }), {
    alternateContent: true,
  });
  const result = await exportMarkdown(bytes, { measurer: createFixedMeasurer() });
  expect(result.media).toHaveLength(0);
  expect(chartWarnings(result)).toEqual([
    'The chart "Net cash" is omitted from Markdown because image export is off.',
  ]);
});

test('a fallback that is a shape, not a picture, is named as such', async () => {
  const bytes = edited('Net cash', { alternateContent: true }, (_files, document) =>
    document.replace(
      /<mc:Fallback>.*<\/mc:Fallback>/,
      '<mc:Fallback><w:pict><v:rect xmlns:v="urn:schemas-microsoft-com:vml" ' +
        'style="width:100pt;height:50pt" fillcolor="#4472C4"/></w:pict></mc:Fallback>'
    )
  );
  const result = await exportMarkdown(bytes, options);
  expect(result.media).toHaveLength(0);
  expect(chartWarnings(result)).toEqual([
    'The chart "Net cash" is omitted from Markdown because its saved fallback is not a picture.',
  ]);
});

test('a fallback picture that cannot be read is named as such', async () => {
  const files = unzipSync(
    chartexDocx(waterfallChartSpace({ title: 'Net cash' }), { alternateContent: true })
  );
  files['word/media/fallback.png'] = strToU8('not a picture');
  const result = await exportMarkdown(zipSync(files), options);
  expect(result.media).toHaveLength(0);
  const [message] = chartWarnings(result);
  expect(message).toStartWith(
    'The chart "Net cash" is omitted from Markdown because its saved fallback picture could not be read ('
  );
});

test('chart warnings on one page stop at the cap and count the rest', async () => {
  const count = MAX_CHART_WARNINGS_PER_PAGE + 2;
  const bytes = edited(
    'Net cash',
    { alternateContent: true, emptyFallback: true, cx: 457200, cy: 228600 },
    (_files, document) =>
      document.replace(/<w:r><mc:AlternateContent>.*<\/mc:AlternateContent><\/w:r>/, (run) =>
        Array.from({ length: count }, () => run).join('')
      )
  );
  const result = await exportMarkdown(bytes, options);
  const messages = chartWarnings(result);
  expect(messages).toHaveLength(MAX_CHART_WARNINGS_PER_PAGE + 1);
  expect(messages.at(-1)).toBe('2 more charts are omitted from Markdown on this page.');
});

// The same author-text rule as with the drawing module installed.
test("a chart shown by its fallback takes the fallback's description when the chart has none", async () => {
  const bytes = edited('Net cash', { alternateContent: true }, (_files, document) =>
    document.replace(
      '<wp:docPr id="2" name="Chart 2"/>',
      '<wp:docPr id="2" name="Chart 2" descr="Cash by quarter"/>'
    )
  );
  const result = await exportMarkdown(bytes, options);
  expect(result.markdown).toMatch(/^!\[Cash by quarter\]\(media\/[0-9a-f]+\.png\)$/);
});

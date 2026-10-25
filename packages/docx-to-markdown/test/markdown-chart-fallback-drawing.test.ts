// With the drawing module installed in the process, the session draws the chart, as the
// editor and PDF export do, and Markdown still exports the picture saved in the chart's
// fallback, with the same alt text and warning rules as without the module. There is no
// Markdown-only session mode: the same session serves PDF with the drawn chart.

import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createFixedMeasurer, forEachSemanticDrawing } from '@docx-editor.dev/core/layout';
import { drawingRenderers } from '../../core/src/store/package/drawing-renderers.ts';
import type { ImageDecodePort } from '../../core/src/store/package/image-resources.ts';
import {
  chartexDocx,
  classicBarChartSpace,
  waterfallChartSpace,
} from '../../core/src/store/__tests__/chartex-fixture.ts';
import { installDrawing } from '../../pro/src/drawing/index.ts';
import type { ExportSession } from '@docx-editor.dev/core/export';
import { exportMarkdown, exportMarkdownFrom, openDocumentForExport } from '../src/index.ts';
import { resolveChartFallbacks } from '../src/markdown-media.ts';

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
        // Layout leaves a drawn chart's fallback picture unread; Markdown reads it on request.
        expect(drawing.chartFallbackResource?.kind).toBe('pending');
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

// One rule gives a chart its author text in every state: the chart drawing's own title and
// description, then the fallback's. The drawing module does not change the alt text.
test("a drawn chart takes the fallback's description when the chart has none", async () => {
  const files = unzipSync(
    chartexDocx(waterfallChartSpace({ title: 'Net cash' }), { alternateContent: true })
  );
  files['word/document.xml'] = strToU8(
    strFromU8(files['word/document.xml']!).replace(
      '<wp:docPr id="2" name="Chart 2"/>',
      '<wp:docPr id="2" name="Chart 2" descr="Cash by quarter"/>'
    )
  );
  const result = await exportMarkdown(zipSync(files), options);
  expect(result.markdown).toMatch(/^!\[Cash by quarter\]\(media\/[0-9a-f]+\.png\)$/);
});

/** A decode port that counts calls and never settles. */
function hangingDecodePort(): { port: ImageDecodePort; calls: () => number } {
  let calls = 0;
  const port = Object.freeze({
    decode: () => {
      calls += 1;
      return new Promise<never>(() => {});
    },
  }) as unknown as ImageDecodePort;
  return { port, calls: () => calls };
}

test('a fallback picture that does not settle in time omits the chart with a warning', async () => {
  const files = unzipSync(
    chartexDocx(waterfallChartSpace({ title: 'Net cash' }), { alternateContent: true })
  );
  // Bytes no earlier test decoded, so no process-wide decode result answers for them.
  const picture = files['word/media/fallback.png']!;
  const unique = new Uint8Array(picture.byteLength + 8);
  unique.set(picture);
  unique.set(strToU8('timeout!'), picture.byteLength);
  files['word/media/fallback.png'] = unique;
  const bytes = zipSync(files);
  const decode = hangingDecodePort();
  const opened = await openDocumentForExport(bytes, {
    measurer: createFixedMeasurer(),
    imageDecodePort: decode.port,
    resourceTimeoutMs: 20,
  });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const result = await exportMarkdownFrom(opened.session, { images: true });
    expect(decode.calls()).toBeGreaterThan(0);
    expect(result.media).toHaveLength(0);
    expect(result.warnings.map((warning) => warning.message)).toContain(
      'The chart "Net cash" is omitted from Markdown because its saved fallback picture could not be read (unrenderable).'
    );
  } finally {
    opened.session.dispose();
  }
});

test('a hidden drawn chart never reads its fallback picture', async () => {
  const bytes = chartexDocx(waterfallChartSpace({ title: 'Net cash' }), {
    alternateContent: true,
  });
  const opened = await openDocumentForExport(bytes, { measurer: createFixedMeasurer() });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    // A record that reserves space only (a wrap footprint) is hidden; a frozen layout cannot
    // carry one for this chart, so a copy marks the drawn chart hidden.
    const layout = structuredClone(await opened.session.layout());
    let charts = 0;
    forEachSemanticDrawing(layout, ({ drawing }) => {
      if (!drawing.chart) return;
      charts += 1;
      (drawing as { accessibility: unknown }).accessibility = {
        ...drawing.accessibility,
        hidden: true,
      };
    });
    expect(charts).toBe(1);
    let reads = 0;
    const session = {
      chartFallbackResource: async () => {
        reads += 1;
        return undefined;
      },
    } as unknown as ExportSession;
    await resolveChartFallbacks(layout, session);
    expect(reads).toBe(0);
  } finally {
    opened.session.dispose();
  }
});

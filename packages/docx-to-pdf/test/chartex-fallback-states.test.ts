/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A drawn chart never reads the picture saved in its `mc:Fallback`: a slow or broken fallback
// neither delays nor fails the export. A chart shown by its fallback whose picture does not
// load (missing, or linked to an external target) shows the chart placeholder, which PDF
// leaves out with the `drawing` diagnostic for a chart.
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { ImageDecodePort } from '../../core/src/store/package/image-resources.ts';
import {
  chartexDocx,
  waterfallChartSpace,
} from '../../core/src/store/__tests__/chartex-fixture.ts';
import { exportPdf } from '../src/index.ts';

type Fallback = 'broken' | 'missing' | 'linked';

/** The wrapped chart with its fallback picture made broken, missing, or linked. */
function chartDocument(layoutId: 'waterfall' | 'treemap', fallback: Fallback): Uint8Array {
  const files = unzipSync(
    chartexDocx(waterfallChartSpace({ title: 'Net', layoutId }), { alternateContent: true })
  );
  if (fallback === 'broken') files['word/media/fallback.png'] = strToU8('not a picture');
  if (fallback === 'missing') delete files['word/media/fallback.png'];
  if (fallback === 'linked') {
    files['word/document.xml'] = strToU8(
      strFromU8(files['word/document.xml']!).replace('r:embed="rId11"', 'r:link="rId11"')
    );
    files['word/_rels/document.xml.rels'] = strToU8(
      strFromU8(files['word/_rels/document.xml.rels']!).replace(
        'Target="media/fallback.png"',
        'Target="https://example.invalid/fallback.png" TargetMode="External"'
      )
    );
  }
  return zipSync(files);
}

test('a drawn chart never waits for a fallback picture that does not settle', async () => {
  let decodes = 0;
  // A decode that never settles: an export that waited for it would time out.
  const hanging = Object.freeze({
    decode: () => {
      decodes += 1;
      return new Promise<never>(() => {});
    },
  }) as unknown as ImageDecodePort;
  const result = await exportPdf(chartDocument('waterfall', 'broken'), {
    useSystemFonts: false,
    imageDecodePort: hanging,
    resourceTimeoutMs: 2_000,
  });
  expect(decodes).toBe(0);
  expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'drawing')).toEqual([]);
});

test('a drawn chart with a broken fallback picture exports without a diagnostic', async () => {
  const result = await exportPdf(chartDocument('waterfall', 'broken'), {
    useSystemFonts: false,
    fidelityPolicy: 'strict',
  });
  expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'drawing')).toEqual([]);
});

for (const fallback of ['missing', 'linked'] as const) {
  test(`a chart whose ${fallback} fallback picture does not load reports the chart`, async () => {
    const result = await exportPdf(chartDocument('treemap', fallback), {
      useSystemFonts: false,
      fidelityPolicy: 'best-effort',
    });
    const drawing = result.diagnostics.filter((diagnostic) => diagnostic.code === 'drawing');
    expect(drawing.map((diagnostic) => diagnostic.message)).toEqual([
      expect.stringContaining('chart'),
    ]);
  });
}

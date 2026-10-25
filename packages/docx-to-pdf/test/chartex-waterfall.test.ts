/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A waterfall chart wrapped in `mc:AlternateContent` exports as vector columns in the data
// colours of their kind, not as its picture fallback and not as a left-out drawing. A chart
// type the module does not draw exports its fallback picture; without one it is left out.
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import {
  chartexDocx,
  waterfallChartSpace,
} from '../../core/src/store/__tests__/chartex-fixture.ts';
import { exportPdf } from '../src/index.ts';

async function firstPageCommands(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes);
  const contents = pdf.getPage(0).node.Contents();
  const streams = contents && 'asArray' in contents ? contents.asArray() : [contents];
  return streams
    .map((ref) => pdf.context.lookup(ref as never))
    .map((stream) =>
      stream instanceof PDFRawStream
        ? new TextDecoder().decode(decodePDFRawStream(stream).decode())
        : ''
    )
    .join('\n');
}

/** The PDF fill operator for a six-digit hex colour, as the writer prints it. */
function fill(hex: string): string {
  const channel = (offset: number) =>
    Number((Number.parseInt(hex.slice(offset, offset + 2), 16) / 255).toFixed(6));
  return `${channel(0)} ${channel(2)} ${channel(4)} rg`;
}

test('a waterfall chart exports as columns in the increase, decrease and total colours', async () => {
  const result = await exportPdf(
    chartexDocx(waterfallChartSpace({ title: 'Net' }), { alternateContent: true }),
    { useSystemFonts: false }
  );
  expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'drawing')).toEqual([]);
  const commands = await firstPageCommands(result.bytes);
  expect(commands).toContain(fill('4472C4'));
  expect(commands).toContain(fill('ED7D31'));
  expect(commands).toContain(fill('A5A5A5'));
});

test('a chart type the module does not draw exports its fallback picture in strict mode', async () => {
  const result = await exportPdf(
    chartexDocx(waterfallChartSpace({ layoutId: 'treemap' }), { alternateContent: true }),
    { useSystemFonts: false, fidelityPolicy: 'strict' }
  );
  expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'drawing')).toEqual([]);
  const commands = await firstPageCommands(result.bytes);
  expect(commands).toMatch(/\/\S+ Do/);
});

test('a chart with no renderer and no fallback picture is left out with a diagnostic', async () => {
  const result = await exportPdf(
    chartexDocx(waterfallChartSpace({ layoutId: 'treemap' }), {
      alternateContent: true,
      emptyFallback: true,
    }),
    { useSystemFonts: false, fidelityPolicy: 'best-effort' }
  );
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('drawing');
});

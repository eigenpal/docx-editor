/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A funnel chart wrapped in `mc:AlternateContent` exports as vector bars, centred and sized by
// value, with a point's own fill kept; not as its picture fallback and not as a left-out drawing.
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { CX, chartexDocx } from '../../core/src/store/__tests__/chartex-fixture.ts';
import { exportPdf } from '../src/index.ts';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function funnelChartSpace(): string {
  const categories = ['Leads', 'Qualified', 'Proposals', 'Won'];
  const values = [400, 300, 150, 40];
  const points = (list: readonly (string | number)[]) =>
    list.map((value, index) => `<cx:pt idx="${index}">${value}</cx:pt>`).join('');
  return (
    `<cx:chartSpace xmlns:cx="${CX}" xmlns:a="${A}"><cx:chartData><cx:data id="0">` +
    `<cx:strDim type="cat"><cx:lvl ptCount="4">${points(categories)}</cx:lvl></cx:strDim>` +
    `<cx:numDim type="val"><cx:lvl ptCount="4" formatCode="General">${points(values)}</cx:lvl></cx:numDim>` +
    '</cx:data></cx:chartData><cx:chart><cx:title pos="t" align="ctr" overlay="0"/>' +
    '<cx:plotArea><cx:plotAreaRegion><cx:series layoutId="funnel">' +
    '<cx:tx><cx:txData><cx:v>Count</cx:v></cx:txData></cx:tx>' +
    '<cx:dataPt idx="2"><cx:spPr><a:solidFill><a:srgbClr val="C00000"/></a:solidFill></cx:spPr></cx:dataPt>' +
    '<cx:dataLabels pos="ctr"><cx:visibility seriesName="0" categoryName="0" value="1"/></cx:dataLabels>' +
    '<cx:dataId val="0"/></cx:series></cx:plotAreaRegion>' +
    '<cx:axis id="0"><cx:catScaling gapWidth="0.06"/><cx:tickLabels/></cx:axis>' +
    '</cx:plotArea></cx:chart></cx:chartSpace>'
  );
}

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

test('a funnel chart exports as bars in the series colour, with a point fill kept', async () => {
  const result = await exportPdf(chartexDocx(funnelChartSpace(), { alternateContent: true }), {
    useSystemFonts: false,
  });
  expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'drawing')).toEqual([]);
  const commands = await firstPageCommands(result.bytes);
  expect(commands).toContain(fill('4472C4'));
  expect(commands).toContain(fill('C00000'));
});

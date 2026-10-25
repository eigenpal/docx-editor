/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A box and whisker chart wrapped in `mc:AlternateContent` exports as vector boxes in the
// series colours, outlined in their shaded line colour, not as its picture fallback.
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { CX, chartexDocx } from '../../core/src/store/__tests__/chartex-fixture.ts';
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

/** The PDF colour operator for a six-digit hex colour, as the writer prints it. */
function color(hex: string, operator: 'rg' | 'RG'): string {
  const channel = (offset: number) =>
    Number((Number.parseInt(hex.slice(offset, offset + 2), 16) / 255).toFixed(6));
  return `${channel(0)} ${channel(2)} ${channel(4)} ${operator}`;
}

/** Two series of raw values over two categories. */
function boxWhiskerChartSpace(): string {
  const categories = ['Q1', 'Q1', 'Q1', 'Q1', 'Q1', 'Q2', 'Q2', 'Q2', 'Q2', 'Q2'];
  const series = [
    [12, 15, 18, 20, 40, 14, 16, 19, 21, 24],
    [8, 11, 13, 16, 18, 9, 10, 14, 15, 19],
  ];
  const points = (list: readonly (string | number)[]) =>
    list.map((value, index) => `<cx:pt idx="${index}">${value}</cx:pt>`).join('');
  const data = series
    .map(
      (values, index) =>
        `<cx:data id="${index}"><cx:strDim type="cat"><cx:lvl ptCount="10">${points(categories)}` +
        `</cx:lvl></cx:strDim><cx:numDim type="val"><cx:lvl ptCount="10" formatCode="General">` +
        `${points(values)}</cx:lvl></cx:numDim></cx:data>`
    )
    .join('');
  const seriesXml = series
    .map(
      (_, index) =>
        `<cx:series layoutId="boxWhisker" formatIdx="${index}"><cx:tx><cx:txData>` +
        `<cx:v>Team ${index + 1}</cx:v></cx:txData></cx:tx><cx:dataId val="${index}"/>` +
        '<cx:layoutPr><cx:visibility meanLine="1" meanMarker="1" nonoutliers="0" outliers="1"/>' +
        '<cx:statistics quartileMethod="exclusive"/></cx:layoutPr></cx:series>'
    )
    .join('');
  return (
    `<cx:chartSpace xmlns:cx="${CX}"><cx:chartData>${data}</cx:chartData><cx:chart>` +
    '<cx:title pos="t" align="ctr" overlay="0"/><cx:plotArea><cx:plotAreaRegion>' +
    `${seriesXml}</cx:plotAreaRegion><cx:axis id="0"><cx:catScaling/><cx:tickLabels/></cx:axis>` +
    '<cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis></cx:plotArea>' +
    '<cx:legend pos="t" align="ctr" overlay="0"/></cx:chart></cx:chartSpace>'
  );
}

test('a box and whisker chart exports as boxes in the series colours with shaded outlines', async () => {
  const result = await exportPdf(chartexDocx(boxWhiskerChartSpace(), { alternateContent: true }), {
    useSystemFonts: false,
  });
  expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'drawing')).toEqual([]);
  const commands = await firstPageCommands(result.bytes);
  expect(commands).toContain(color('4472C4', 'rg'));
  expect(commands).toContain(color('ED7D31', 'rg'));
  expect(commands).toContain(color('365B9D', 'RG'));
  expect(commands).toContain(color('BE6427', 'RG'));
});

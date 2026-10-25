/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A histogram and a Pareto chart wrapped in `mc:AlternateContent` export as vector columns
// (and the Pareto line), not as their picture fallback and not as a left-out drawing.
import { expect, test } from 'bun:test';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { CX, chartexDocx } from '../../core/src/store/__tests__/chartex-fixture.ts';
import { exportPdf } from '../src/index.ts';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

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

/** The PDF colour operands for a six-digit hex colour, as the writer prints them. */
function color(hex: string): string {
  const channel = (offset: number) =>
    Number((Number.parseInt(hex.slice(offset, offset + 2), 16) / 255).toFixed(6));
  return `${channel(0)} ${channel(2)} ${channel(4)}`;
}

function chartSpace(pareto: boolean): string {
  const values = [12, 30, 7, 18, 3, 9, 30, 4];
  const categories = ['Late', 'Damaged', 'Wrong', 'Missing', 'Other', 'Billing', 'Late', 'Rude'];
  const points = (list: readonly (string | number)[]) =>
    list.map((value, index) => `<cx:pt idx="${index}">${value}</cx:pt>`).join('');
  const cat = pareto
    ? `<cx:strDim type="cat"><cx:lvl ptCount="8">${points(categories)}</cx:lvl></cx:strDim>`
    : '';
  const layout = pareto ? '<cx:aggregation/>' : '<cx:binning intervalClosed="r"/>';
  const line = pareto
    ? '<cx:axisId val="1"/></cx:series><cx:series layoutId="paretoLine" ownerIdx="0"><cx:axisId val="2"/></cx:series>'
    : '</cx:series>';
  const percent = pareto
    ? '<cx:axis id="2"><cx:valScaling max="1" min="0"/><cx:units unit="percentage"/><cx:tickLabels/></cx:axis>'
    : '';
  return (
    `<cx:chartSpace xmlns:cx="${CX}" xmlns:a="${A}"><cx:chartData><cx:data id="0">${cat}` +
    `<cx:numDim type="val"><cx:lvl ptCount="8" formatCode="General">${points(values)}</cx:lvl></cx:numDim>` +
    '</cx:data></cx:chartData><cx:chart><cx:title pos="t" align="ctr" overlay="0"/><cx:plotArea>' +
    `<cx:plotAreaRegion><cx:series layoutId="clusteredColumn"><cx:dataId val="0"/><cx:layoutPr>${layout}</cx:layoutPr>${line}` +
    '</cx:plotAreaRegion><cx:axis id="0"><cx:catScaling gapWidth="0"/><cx:tickLabels/></cx:axis>' +
    `<cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis>${percent}` +
    '</cx:plotArea></cx:chart></cx:chartSpace>'
  );
}

test('a histogram exports as columns in the first data colour', async () => {
  const result = await exportPdf(chartexDocx(chartSpace(false), { alternateContent: true }), {
    useSystemFonts: false,
  });
  expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'drawing')).toEqual([]);
  const commands = await firstPageCommands(result.bytes);
  expect(commands).toContain(`${color('4472C4')} rg`);
});

test('a Pareto chart exports its columns and its cumulative line', async () => {
  const result = await exportPdf(chartexDocx(chartSpace(true), { alternateContent: true }), {
    useSystemFonts: false,
  });
  expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'drawing')).toEqual([]);
  const commands = await firstPageCommands(result.bytes);
  expect(commands).toContain(`${color('4472C4')} rg`);
  expect(commands).toContain(`${color('ED7D31')} RG`);
});

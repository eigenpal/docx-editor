/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { PDFDocument, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

function input(open = false, unsupported = false) {
  const polygon = (low: number, high: number) =>
    `<a:moveTo><a:pt x="${low}" y="${low}"/></a:moveTo><a:lnTo><a:pt x="${high}" y="${low}"/></a:lnTo><a:lnTo><a:pt x="${high}" y="${high}"/></a:lnTo><a:lnTo><a:pt x="${low}" y="${high}"/></a:lnTo><a:close/>`;
  const geometry = open
    ? '<a:prstGeom prst="line"><a:avLst/></a:prstGeom>'
    : `<a:custGeom><a:pathLst><a:path w="1000" h="1000">${polygon(0, 1000)}${polygon(250, 750)}</a:path></a:pathLst></a:custGeom>`;
  return docx(`<w:p><w:r><w:drawing
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
    xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
    <wp:inline><wp:extent cx="1270000" cy="635000"/><wp:docPr id="1" name="Shape"/>
    <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
    <wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="635000"/></a:xfrm>${geometry}
    ${open ? '<a:noFill/>' : '<a:solidFill><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:solidFill>'}
    <a:ln w="12700"><a:solidFill><a:srgbClr val="0000FF"><a:alpha val="25000"/></a:srgbClr></a:solidFill>
    ${open ? `<a:tailEnd type="${unsupported ? 'stealth' : 'triangle'}" w="med" len="med"/>` : ''}
    </a:ln></wps:spPr></wps:wsp></a:graphicData></a:graphic></wp:inline>
    </w:drawing></w:r></w:p>`);
}

async function inspect(open: boolean) {
  const result = await exportPdf(input(open), { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const pdf = await PDFDocument.load(result.bytes);
  const commands = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, value]) =>
      value instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(value).decode())]
        : []
    )
    .filter((text) => text.includes('ShapeAlpha'))
    .join('\n');
  const states = pdf.getPage(0).node.Resources()!.lookup(PDFName.of('ExtGState'), PDFDict);
  return { commands, states: states.keys().map((key) => states.lookup(key, PDFDict)) };
}

test('solid shape holes use even-odd fill with independent fill and stroke opacity', async () => {
  const { commands, states } = await inspect(false);
  expect(commands).toContain('0 0 m 100 0 l 100 50 l 0 50 l h');
  expect(commands).toContain('25 12.5 m 75 12.5 l 75 37.5 l 25 37.5 l h');
  expect(commands).toContain('\nB*\n');
  expect(commands).toContain('1 0 0 rg');
  expect(commands).toContain('0 0 1 RG 1 w');
  expect(states[0]!.get(PDFName.of('ca'))!.toString()).toBe('0.5');
  expect(states[0]!.get(PDFName.of('CA'))!.toString()).toBe('0.25');
});

test('open connectors remain open and arrowheads inherit stroke opacity', async () => {
  const { commands, states } = await inspect(true);
  expect(commands).toContain('0 0 m 100 50 l\nS');
  expect(commands).not.toContain('0 0 m 100 50 l h');
  expect(commands).toContain('h f');
  expect(states.at(-1)!.get(PDFName.of('ca'))!.toString()).toBe('0.25');
});

test('an edge rule widens the clip by half its stroke on its own side only', async () => {
  // A 100pt x 50pt group whose only child is a 2pt vertical rule on its left edge.
  const bytes = docx(`<w:p><w:r><w:drawing
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
    xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
    xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">
    <wp:inline><wp:extent cx="1270000" cy="635000"/><wp:effectExtent l="0" t="0" r="0" b="0"/>
    <wp:docPr id="1" name="Rule"/>
    <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">
    <wpg:wgp><wpg:grpSpPr><a:xfrm><a:chOff x="0" y="0"/><a:chExt cx="1270000" cy="635000"/></a:xfrm>
    </wpg:grpSpPr><wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="635000"/></a:xfrm>
    <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
    <a:ln w="25400"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
    </wps:spPr></wps:wsp></wpg:wgp></a:graphicData></a:graphic></wp:inline>
    </w:drawing></w:r></w:p>`);
  const result = await exportPdf(bytes, { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const pdf = await PDFDocument.load(result.bytes);
  const commands = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, value]) =>
      value instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(value).decode())]
        : []
    )
    .find((text) => text.includes('ShapeAlpha'))!;
  const match = /q (\S+) (\S+) (\S+) (\S+) re W n\n\S+ 0 0 \S+ (\S+) \S+ cm/.exec(commands)!;
  const [clipX, , clipWidth, clipHeight, contentX] = match.slice(1, 6).map(Number);
  expect(clipX).toBeCloseTo(contentX! - 1, 3);
  expect(clipWidth).toBeCloseTo(101, 3);
  // Butt caps add nothing above or below a vertical rule.
  expect(clipHeight).toBeCloseTo(50, 3);
});

async function insetCommands(fill: string) {
  const bytes = docx(`<w:p><w:r><w:drawing
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
    xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
    <wp:inline><wp:extent cx="1270000" cy="635000"/><wp:docPr id="1" name="Box"/>
    <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
    <wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="635000"/></a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}
    <a:ln w="25400" algn="in"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
    </wps:spPr></wps:wsp></a:graphicData></a:graphic></wp:inline>
    </w:drawing></w:r></w:p>`);
  const result = await exportPdf(bytes, { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const pdf = await PDFDocument.load(result.bytes);
  return pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, value]) =>
      value instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(value).decode())]
        : []
    )
    .find((text) => text.includes('ShapeAlpha'))!;
}

test('an inset outline strokes at twice its width inside a clip to its own path', async () => {
  const box = '0 0 m 100 0 l 100 50 l 0 50 l h';
  // The path is written once as the clip and once to paint, with or without a fill.
  const outline = await insetCommands('<a:noFill/>');
  expect(outline).toContain(`0 0 0 RG 4 w\nq ${box} W* n\n${box}\nS Q`);
  expect(outline.split(box)).toHaveLength(3);
  const filled = await insetCommands('<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>');
  expect(filled).toContain(`q ${box} W* n\n${box}\nB* Q`);
  expect(filled.split(box)).toHaveLength(3);
});

test('a standalone vertical line exports with a clip one stroke wide', async () => {
  const bytes = docx(`<w:p><w:r><w:drawing
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
    xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
    xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
    <wp:inline><wp:extent cx="0" cy="635000"/><wp:docPr id="1" name="Line"/>
    <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
    <wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="635000"/></a:xfrm>
    <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
    <a:ln w="25400"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>
    </wps:spPr></wps:wsp></a:graphicData></a:graphic></wp:inline>
    </w:drawing></w:r></w:p>`);
  const result = await exportPdf(bytes, { useSystemFonts: false });
  expect(result.diagnostics).toEqual([]);
  const pdf = await PDFDocument.load(result.bytes);
  const commands = pdf.context
    .enumerateIndirectObjects()
    .flatMap(([, value]) =>
      value instanceof PDFRawStream
        ? [new TextDecoder().decode(decodePDFRawStream(value).decode())]
        : []
    )
    .find((text) => text.includes('ShapeAlpha'))!;
  const match = /q (\S+) (\S+) (\S+) (\S+) re W n\n(\S+) 0 0 (\S+) \S+ \S+ cm/.exec(commands)!;
  const [, , width, height, sx, sy] = match.slice(1, 7).map(Number);
  expect(width).toBeCloseTo(2, 3);
  expect(height).toBeCloseTo(50, 3);
  // The collapsed axis borrows the other axis's scale, so the stroke keeps its width.
  expect(sx).toBeCloseTo(1, 6);
  expect(sy).toBeCloseTo(-1, 6);
  expect(commands).toContain('0 0 m 0 50 l\nS');
});

test('geometry outside Core admission still refuses strict export', async () => {
  await expect(exportPdf(input(true, true))).rejects.toMatchObject({
    diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'drawing' })]),
  });
});

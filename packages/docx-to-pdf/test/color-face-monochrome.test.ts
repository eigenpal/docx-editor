/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as fontkit from 'fontkit';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createFontSource } from '@docx-editor.dev/core/editor';
import { colorGlyph, glyphOutline } from '../src/color-glyphs.ts';
import { Work } from '../src/context.ts';
import { exportPdf } from '../src/index.ts';
import { docx } from './fixture.ts';

// A face with both color glyphs and monochrome outlines, as emoji faces that also cover
// Latin text are. Built from a text face by adding COLR v0 and CPAL tables: `X` becomes a
// color glyph of two layers, a red `O` and an `I` in the text color (palette index 0xFFFF).
// Every other glyph keeps only its own outline.
const FAMILY = 'Hybrid Color Test';
const textFace = new Uint8Array(
  readFileSync(
    new URL('../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url)
  )
);

function withTables(source: Uint8Array, added: Record<string, Uint8Array>): Uint8Array {
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(...source.subarray(record, record + 4));
    const offset = view.getUint32(record + 8);
    tables.set(tag, source.subarray(offset, offset + view.getUint32(record + 12)));
  }
  for (const [tag, bytes] of Object.entries(added)) tables.set(tag, bytes);
  const tags = [...tables.keys()].sort();
  const headerLength = 12 + tags.length * 16;
  const total = tags.reduce((sum, tag) => sum + ((tables.get(tag)!.length + 3) & ~3), headerLength);
  const out = new Uint8Array(total);
  const writer = new DataView(out.buffer);
  out.set(source.subarray(0, 4));
  writer.setUint16(4, tags.length);
  let at = headerLength;
  tags.forEach((tag, i) => {
    const bytes = tables.get(tag)!;
    const record = 12 + i * 16;
    for (let c = 0; c < 4; c++) writer.setUint8(record + c, tag.charCodeAt(c));
    writer.setUint32(record + 8, at);
    writer.setUint32(record + 12, bytes.length);
    out.set(bytes, at);
    at += (bytes.length + 3) & ~3;
  });
  return out;
}

function hybridFace(damaged = false): Uint8Array {
  const face = fontkit.create(Buffer.from(textFace)) as fontkit.FontkitFont;
  const gid = (char: string) => face.glyphForCodePoint(char.codePointAt(0)!).id;
  const colr = new DataView(new ArrayBuffer(14 + 6 + 8));
  colr.setUint16(2, 1); // one base glyph record
  // A damaged table points its base glyph records past the end of the file.
  colr.setUint32(4, damaged ? 0x7fffff00 : 14);
  colr.setUint32(8, 20);
  colr.setUint16(12, 2); // two layer records
  colr.setUint16(14, gid('X'));
  colr.setUint16(16, 0);
  colr.setUint16(18, 2);
  colr.setUint16(20, gid('O'));
  colr.setUint16(22, 0);
  colr.setUint16(24, gid('I'));
  colr.setUint16(26, 0xffff);
  const cpal = new Uint8Array(18);
  const palette = new DataView(cpal.buffer);
  palette.setUint16(2, 1); // entries per palette
  palette.setUint16(4, 1); // palettes
  palette.setUint16(6, 1); // color records
  palette.setUint32(8, 14);
  cpal.set([0, 0, 255, 255], 14); // blue, green, red, alpha
  return withTables(textFace, { COLR: new Uint8Array(colr.buffer), CPAL: cpal });
}

const hybrid = hybridFace();
const damaged = hybridFace(true);
const ARIAL = 'Arial';

interface Exported {
  readonly result: Awaited<ReturnType<typeof exportPdf>>;
  readonly content: string;
  /** The outline commands of every glyph in each embedded TrueType subset. */
  readonly embedded: readonly (readonly number[])[];
  /** Font resources that a page names and that the file does not hold. */
  readonly dangling: readonly string[];
}

async function exported(
  runs: string,
  paragraphProperties = '',
  colorFace = hybrid
): Promise<Exported> {
  const sources = [
    createFontSource(colorFace, { family: FAMILY, weight: 400, style: 'normal' }),
    createFontSource(textFace, { family: ARIAL, weight: 400, style: 'normal' }),
  ].map((source) => {
    if ('failure' in source) throw new Error(JSON.stringify(source.failure));
    return source.source;
  });
  const result = await exportPdf(docx(`<w:p>${paragraphProperties}${runs}</w:p>`), {
    useSystemFonts: false,
    fonts: { sources },
  });
  const parsed = await PDFDocument.load(result.bytes);
  const dangling: string[] = [];
  for (const page of parsed.getPages()) {
    const fonts = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
    for (const [name, ref] of fonts?.entries() ?? [])
      if (ref instanceof PDFRef && !parsed.context.lookup(ref)) dangling.push(name.asString());
  }
  const streams: string[] = [];
  const embedded: number[][] = [];
  for (const [, object] of parsed.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const bytes = decodePDFRawStream(object).decode();
    if (object.dict.has(PDFName.of('Length1'))) {
      const subset = fontkit.create(Buffer.from(bytes)) as fontkit.FontkitFont;
      embedded.push(
        Array.from(
          { length: subset.numGlyphs },
          (_, id) => subset.getGlyph(id).path.commands.length
        )
      );
    } else {
      streams.push(new TextDecoder().decode(bytes));
    }
  }
  return {
    result,
    dangling,
    content: streams.filter((s) => s.includes('BT')).join('\n'),
    embedded,
  };
}

function run(text: string, family = FAMILY, properties = ''): string {
  return `<w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/>${properties}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
}

async function extractedText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    return content.items.map((item) => ('str' in item ? item.str : '')).join('');
  } finally {
    await pdf.loadingTask.destroy();
  }
}

const colorDiagnostics = ({ result }: Exported) =>
  result.diagnostics.filter((d) => d.code === 'color-glyph');

test('the monochrome glyphs of a color face are written as text in its embedded subset', async () => {
  const pdf = await exported(run('Puntuación 64', FAMILY, '<w:color w:val="1F4E79"/>'));
  expect(colorDiagnostics(pdf)).toEqual([]);
  expect(pdf.content).toContain('0.121569 0.305882 0.47451 rg');
  expect(pdf.content).not.toContain('3 Tr');
  // One subset, the color face's: the accented `ó` is a composite and still has its outline.
  expect(pdf.embedded).toHaveLength(1);
  const inked = pdf.embedded[0]!.filter((commands) => commands > 0).length;
  expect(inked).toBeGreaterThanOrEqual(11);
  expect(await extractedText(pdf.result.bytes)).toContain('Puntuación 64');
});

test('a color glyph fills its palette layers, and index 0xFFFF takes the text color', async () => {
  const pdf = await exported(run('aXa', FAMILY, '<w:color w:val="00B050"/>'));
  expect(colorDiagnostics(pdf)).toEqual([]);
  expect(pdf.content).toMatch(/1 0 0 rg [\d.\- mlch]+ f/);
  expect(pdf.content).toMatch(/0 0\.690196 0\.313725 rg [\d.\- mlch]+ f/);
  // The color glyph's character rides the face's own invisible space, so a run in a color
  // face alone still extracts in full.
  expect(pdf.content).toContain('3 Tr');
  expect(await extractedText(pdf.result.bytes)).toContain('aXa');
});

test('text in a color face extracts beside text in another face', async () => {
  const pdf = await exported(run('Before: ', ARIAL) + run('Puntuación X á é', FAMILY));
  expect(colorDiagnostics(pdf)).toEqual([]);
  expect(pdf.embedded).toHaveLength(2);
  expect((await extractedText(pdf.result.bytes)).replace(/\s+/g, ' ')).toContain(
    'Before: Puntuación X á é'
  );
});

test('a run that paints only color glyphs embeds no outline of the color face', async () => {
  const pdf = await exported(run('Done ', ARIAL) + run('X', FAMILY));
  expect(colorDiagnostics(pdf)).toEqual([]);
  // The color face lends only its space to carry `X`; glyph 0 is the subset's .notdef.
  const subsets = pdf.embedded.map((glyphs) => glyphs.slice(1).filter((c) => c > 0).length);
  expect(subsets.sort()).toEqual([0, 4]);
  expect(await extractedText(pdf.result.bytes)).toContain('Done X');
});

test('a page never names a color face that writes no glyph', async () => {
  // A space on a right-to-left line is not written, so the color face encodes nothing.
  const hebrew = (text: string) =>
    `<w:r><w:rPr><w:rFonts w:ascii="${ARIAL}" w:hAnsi="${ARIAL}" w:cs="${ARIAL}"/><w:rtl/></w:rPr><w:t>${text}</w:t></w:r>`;
  const space = `<w:r><w:rPr><w:rFonts w:ascii="${FAMILY}" w:hAnsi="${FAMILY}" w:cs="${FAMILY}"/><w:rtl/></w:rPr><w:t xml:space="preserve"> </w:t></w:r>`;
  const pdf = await exported(hebrew('שלום') + space + hebrew('עולם'), '<w:pPr><w:bidi/></w:pPr>');
  expect(pdf.dangling).toEqual([]);
  for (const color of [run('aXa'), run('Done ', ARIAL) + run('X')])
    expect((await exported(color)).dangling).toEqual([]);
});

test('a face whose color table is damaged still exports its text', async () => {
  const pdf = await exported(run('Puntuación 64'), '', damaged);
  expect(pdf.dangling).toEqual([]);
  expect(await extractedText(pdf.result.bytes)).toContain('Puntuación 64');
});

test('synthetic bold strokes a monochrome glyph of a color face', async () => {
  const pdf = await exported(run('a', FAMILY, '<w:b/>'));
  expect(pdf.content).toMatch(/0 0 0 RG\n[\d.]+ w 2 Tr/);
});

test('outlines survive glyphs that fontkit has already cached as color glyphs', () => {
  const face = fontkit.create(Buffer.from(hybrid)) as fontkit.FontkitFont;
  const work = new Work(new AbortController().signal);
  const id = (char: string) => face.glyphForCodePoint(char.codePointAt(0)!).id;
  // fontkit's own lookups store color wrappers, with empty paths, in the face's cache.
  for (const char of 'aOoó') face.getGlyph(id(char));
  expect(colorGlyph(face, id('a'), work)).toEqual({ kind: 'none' });
  const color = colorGlyph(face, id('X'), work);
  expect(color.kind).toBe('layers');
  if (color.kind === 'layers') expect(color.layers.map((l) => l.fill)).toEqual(['1 0 0 rg', null]);
  // A composite expands through the outline view, components included.
  expect(glyphOutline(face, id('ó'), work)).toBeTruthy();
  // The face's own cache keeps fontkit's wrapper, so its later lookups are unchanged.
  expect((face.getGlyph(id('a')) as { type?: string }).type).toBe('COLR');
});

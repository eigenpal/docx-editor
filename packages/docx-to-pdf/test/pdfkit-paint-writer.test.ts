/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { ExportResourceError } from '@docx-editor.dev/core/export';
import { FONT_ASSET_MANIFEST, FONT_ASSET_ROOT } from '@docx-editor.dev/fonts';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { coreBoxToPdfRect, coreYToPdfY } from '../src/pdf-coordinates.ts';
import { HARD_MAX_OUTPUT_BYTES, PdfPaintValidationError } from '../src/pdf-paint-bounds.ts';
import {
  createPdfPaintPlan,
  pdfBeginPage,
  pdfClipRect,
  pdfDestination,
  pdfExternalLink,
  pdfFillRect,
  pdfInternalLink,
  pdfRestoreState,
  pdfSaveState,
  pdfStrokeRect,
  pdfTextSpan,
  type PdfPaintCommand,
} from '../src/pdf-paint-types.ts';
import { pdfTextStyleFromResolvedRunStyle } from '../src/pdf-text-style.ts';
import { writePdfPaintPlanToBytes } from '../src/pdfkit-paint-writer.ts';

function resolvedStyle(fontFamily: string | null) {
  return pdfTextStyleFromResolvedRunStyle({
    fontFamily,
    fontFamilyEastAsia: null,
    fontSizePt: 12,
    color: '000000',
    bold: false,
    italic: false,
    underline: null,
    strike: false,
    doubleStrike: false,
    highlight: null,
    shading: null,
    verticalAlign: 'baseline',
    baselineShiftPt: 0,
    caps: false,
    smallCaps: false,
    characterSpacingPt: 0,
    horizontalScalePercent: 100,
    kerningMinPt: 0,
    hidden: false,
  });
}

const sampleStyle = resolvedStyle('Arial');
const admittedFontBytes = new Uint8Array(
  readFileSync(fileURLToPath(new URL(FONT_ASSET_MANIFEST[0]!.file, FONT_ASSET_ROOT)))
);
const unicodeFontBytes = new Uint8Array(
  readFileSync(fileURLToPath(import.meta.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf')))
);
const admittedFont = Object.freeze({
  id: 'test:admitted-font',
  identity: 'sha256:test#0',
  family: 'Test Font',
  request: Object.freeze({ family: 'Test Font', weight: 400 as const, style: 'normal' as const }),
  byteLength: admittedFontBytes.byteLength,
  hash: 'sha256:test',
  faceIndex: 0,
  bytes: admittedFontBytes,
});
const unicodeFont = Object.freeze({
  ...admittedFont,
  id: 'test:unicode-font',
  identity: 'sha256:unicode#0',
  family: 'Unicode Font',
  request: Object.freeze({
    family: 'Unicode Font',
    weight: 400 as const,
    style: 'normal' as const,
  }),
  byteLength: unicodeFontBytes.byteLength,
  hash: 'sha256:unicode',
  bytes: unicodeFontBytes,
});

function pdfLatin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

function pdfContentStreams(bytes: Uint8Array): string {
  const pdf = Buffer.from(bytes);
  const text = pdf.toString('latin1');
  const streams: string[] = [];
  for (const match of text.matchAll(/\/Filter \/FlateDecode\s*>>\s*stream\n/g)) {
    const start = match.index! + match[0].length;
    const end = text.indexOf('\nendstream', start);
    if (end < 0) continue;
    streams.push(inflateSync(pdf.subarray(start, end)).toString('latin1'));
  }
  return streams.join('\n');
}

function extractMediaBoxes(pdf: string): number[][] {
  return [...pdf.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map((match) =>
    match[1]!.trim().split(/\s+/).map(Number)
  );
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const document = await getDocument({ data: bytes.slice() }).promise;
  try {
    const text: string[] = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      text.push(...content.items.map((item) => ('str' in item ? item.str : '')));
    }
    return text.join('');
  } finally {
    document.cleanup();
  }
}

function os2FsTypeOffset(bytes: Uint8Array): number {
  const tableCount = (bytes[4]! << 8) | bytes[5]!;
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    if (String.fromCharCode(...bytes.subarray(record, record + 4)) !== 'OS/2') continue;
    return (
      bytes[record + 8]! * 0x1000000 +
      (bytes[record + 9]! << 16) +
      (bytes[record + 10]! << 8) +
      bytes[record + 11]!
    );
  }
  throw new Error('Expected the packaged test font to include an OS/2 table');
}

describe('PdfKit paint writer', () => {
  test('writes a valid PDF header and page objects', async () => {
    const plan = createPdfPaintPlan([
      pdfBeginPage(0, 612, 792),
      pdfFillRect({ x: 0, y: 0, width: 612, height: 792 }, '#FFFFFF'),
    ]);

    const result = await writePdfPaintPlanToBytes(plan);
    const pdf = pdfLatin1(result.bytes);

    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toContain('%%EOF');
    expect(result.pageCount).toBe(1);
    expect((pdf.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(1);
  });

  test('preserves mixed page sizes from begin-page commands', async () => {
    const plan = createPdfPaintPlan([pdfBeginPage(0, 612, 792), pdfBeginPage(1, 841.89, 595.28)]);

    const result = await writePdfPaintPlanToBytes(plan);
    const boxes = extractMediaBoxes(pdfLatin1(result.bytes));

    expect(result.pageCount).toBe(2);
    expect(boxes).toEqual([
      [0, 0, 612, 792],
      [0, 0, 841.89, 595.28],
    ]);
  });

  test('produces deterministic bytes for identical plans', async () => {
    const plan = createPdfPaintPlan([
      pdfBeginPage(0, 612, 792),
      pdfSaveState(),
      pdfClipRect({ x: 72, y: 600, width: 200, height: 100 }),
      pdfFillRect({ x: 72, y: 600, width: 200, height: 100 }, '#FF0000'),
      pdfRestoreState(),
      pdfTextSpan({ x: 72, y: 680, width: 120, height: 12 }, 112, 'Deterministic', sampleStyle),
      pdfExternalLink({ x: 72, y: 680, width: 120, height: 12 }, 'https://example.com/stable'),
    ]);

    const first = await writePdfPaintPlanToBytes(plan);
    const second = await writePdfPaintPlanToBytes(plan);

    expect(first.bytes).toEqual(second.bytes);
    expect(pdfLatin1(first.bytes)).toContain('D:20200101000000Z');
  });

  test('extracts Polish, Cyrillic, and supplementary Unicode through PDF.js when embedded', async () => {
    const text = 'Zażółć Привет 𝟘';
    const result = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan(
          { x: 72, y: 680, width: 200, height: 12 },
          688,
          text,
          resolvedStyle('Unicode Font')
        ),
      ]),
      { admittedFonts: [unicodeFont] }
    );

    expect(await extractPdfText(result.bytes)).toContain(text);
  });

  test('omits WinAnsi-unsafe standard-font fallback text without PDF.js garbage', async () => {
    const text = 'Zażółć Привет 𝟘';
    const result = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan({ x: 72, y: 680, width: 200, height: 12 }, 688, text, resolvedStyle('Arial')),
      ])
    );

    expect(await extractPdfText(result.bytes)).toBe('');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: 'unsupported',
        feature: 'standard-font-encoding',
        pageIndex: 0,
        recordId: 'Arial',
        reason: 'Text cannot be encoded with PDF built-in font WinAnsiEncoding for "Arial"',
      })
    );
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ feature: 'shaped-glyph-run' })
    );
  });

  test('paints WinAnsi-safe text through standard-font fallback', async () => {
    const result = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan(
          { x: 72, y: 680, width: 120, height: 12 },
          688,
          'Hello — €',
          resolvedStyle('Arial')
        ),
      ])
    );

    expect(await extractPdfText(result.bytes)).toBe('Hello — €');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ feature: 'standard-font-substitution', recordId: 'Arial' })
    );
  });

  test('embeds admitted bytes for Unicode instead of WinAnsi standard fonts', async () => {
    const style = resolvedStyle('Test Font');
    const result = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan({ x: 72, y: 680, width: 100, height: 12 }, 688, 'Привет 世界', style),
      ]),
      { admittedFonts: [admittedFont] }
    );
    const pdf = pdfLatin1(result.bytes);

    expect(pdf).toContain('/FontFile2');
    expect(pdf).toContain('/ToUnicode');
    expect(pdf).not.toContain('/Encoding /WinAnsiEncoding');
    expect(result.diagnostics).toMatchObject([
      { feature: 'shaped-glyph-run', recordId: admittedFont.identity },
    ]);
  });

  test('refuses OS/2 no-embedding and no-subsetting faces before registration', async () => {
    const offset = os2FsTypeOffset(admittedFontBytes);
    for (const fsType of [0x0002, 0x0100]) {
      const bytes = admittedFontBytes.slice();
      bytes[offset + 8] = fsType >> 8;
      bytes[offset + 9] = fsType & 0xff;
      const result = await writePdfPaintPlanToBytes(
        createPdfPaintPlan([
          pdfBeginPage(0, 612, 792),
          pdfTextSpan(
            { x: 72, y: 680, width: 100, height: 12 },
            688,
            'Restricted',
            resolvedStyle('Test Font')
          ),
        ]),
        { admittedFonts: [{ ...admittedFont, bytes }] }
      );

      expect(pdfLatin1(result.bytes)).not.toContain('/FontFile2');
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ kind: 'unsupported', feature: 'font-embedding-permission' })
      );
    }
  });

  test('keeps aliases for one admitted resource embedded and registered once', async () => {
    const alias = Object.freeze({
      ...admittedFont,
      request: Object.freeze({
        family: 'Alias Font',
        weight: 400 as const,
        style: 'normal' as const,
      }),
    });
    const result = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan(
          { x: 72, y: 700, width: 100, height: 12 },
          708,
          'First',
          resolvedStyle('Test Font')
        ),
        pdfTextSpan(
          { x: 72, y: 680, width: 100, height: 12 },
          688,
          'Second',
          resolvedStyle('Alias Font')
        ),
      ]),
      { admittedFonts: [admittedFont, alias] }
    );

    expect(pdfLatin1(result.bytes).match(/\/FontFile2/g) ?? []).toHaveLength(1);
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ feature: 'standard-font-substitution', recordId: 'Alias Font' })
    );
  });

  test('refuses a nonzero collection faceIndex without selecting a face by guesswork', async () => {
    const collection = new Uint8Array(admittedFontBytes.byteLength + 16);
    collection.set([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 16]);
    collection.set(admittedFontBytes, 16);
    const result = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan(
          { x: 72, y: 680, width: 100, height: 12 },
          688,
          'Face',
          resolvedStyle('Test Font')
        ),
      ]),
      {
        admittedFonts: [
          { ...admittedFont, bytes: collection, faceIndex: 1, identity: 'sha256:test#1' },
        ],
      }
    );

    expect(pdfLatin1(result.bytes)).not.toContain('/FontFile2');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        feature: 'font-embedding-permission',
        reason:
          'PDFKit exposes a collection family selector, but Core does not expose the selected face name needed to prove faceIndex selection',
      })
    );
  });

  test('refuses a faceIndex-zero TTC collection without parsing its header as sfnt', async () => {
    const collection = new Uint8Array(admittedFontBytes.byteLength + 16);
    collection.set([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 16]);
    collection.set(admittedFontBytes, 16);
    const result = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan(
          { x: 72, y: 680, width: 100, height: 12 },
          688,
          'Face',
          resolvedStyle('Test Font')
        ),
      ]),
      {
        admittedFonts: [{ ...admittedFont, bytes: collection, faceIndex: 0 }],
      }
    );

    expect(pdfLatin1(result.bytes)).not.toContain('/FontFile2');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: 'unsupported',
        feature: 'font-embedding-permission',
        reason:
          'PDFKit exposes a collection family selector, but Core does not expose the selected face name needed to prove faceIndex selection',
      })
    );
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ reason: expect.stringContaining('OS/2 fsType forbids') })
    );
  });

  test('compresses streams deterministically and scales text to planned width', async () => {
    const plan = createPdfPaintPlan([
      pdfBeginPage(0, 612, 792),
      pdfTextSpan({ x: 72, y: 680, width: 250, height: 12 }, 688, 'Width match', sampleStyle),
    ]);
    const first = await writePdfPaintPlanToBytes(plan);
    const second = await writePdfPaintPlanToBytes(plan);

    expect(first.bytes).toEqual(second.bytes);
    expect(pdfLatin1(first.bytes)).toContain('/Filter /FlateDecode');
    expect(pdfContentStreams(first.bytes)).toContain('Tz');
  });

  test('draws every text decoration as manual strokes', async () => {
    const underline = { ...resolvedStyle('Helvetica'), decoration: 'underline' as const };
    const strike = { ...resolvedStyle('Helvetica'), decoration: 'strike' as const };
    const doubleStrike = { ...resolvedStyle('Helvetica'), decoration: 'double-strike' as const };
    const result = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan({ x: 72, y: 700, width: 40, height: 12 }, 708, 'U', underline),
        pdfTextSpan({ x: 72, y: 680, width: 40, height: 12 }, 688, 'S', strike),
        pdfTextSpan({ x: 72, y: 660, width: 40, height: 12 }, 668, 'D', doubleStrike),
      ])
    );
    const content = pdfContentStreams(result.bytes);

    expect((content.match(/\nS\n/g) ?? []).length).toBe(4);
    expect(content).not.toContain('underline');
    expect(content).not.toContain('strike');
  });

  test('emits rectangular clipping operators in page content', async () => {
    const plan = createPdfPaintPlan([
      pdfBeginPage(0, 612, 792),
      pdfSaveState(),
      pdfClipRect({ x: 100, y: 442, width: 300, height: 200 }),
      pdfFillRect({ x: 100, y: 442, width: 300, height: 200 }, '#00FF00'),
      pdfRestoreState(),
    ]);

    const result = await writePdfPaintPlanToBytes(plan);
    const pdf = pdfContentStreams(result.bytes);

    expect(pdf).toMatch(/\bW\b|\bW\*\b/);
    expect(pdf).toContain(' n');
    expect(pdf).toMatch(/\bq\b/);
    expect(pdf).toMatch(/\bQ\b/);
  });

  test('emits external link annotations for sanitized URLs', async () => {
    const plan = createPdfPaintPlan([
      pdfBeginPage(0, 612, 792),
      pdfExternalLink({ x: 72, y: 700, width: 180, height: 20 }, 'https://example.com/doc'),
    ]);

    const result = await writePdfPaintPlanToBytes(plan);
    const pdf = pdfLatin1(result.bytes);

    expect(pdf).toContain('/Subtype /Link');
    expect(pdf).toContain('/URI (https://example.com/doc)');
  });

  test('strokes rectangles with the requested line width and color', async () => {
    const plan = createPdfPaintPlan([
      pdfBeginPage(0, 612, 792),
      pdfStrokeRect({ x: 50, y: 600, width: 100, height: 80 }, '#0000FF', 2.5),
    ]);

    const result = await writePdfPaintPlanToBytes(plan);
    const pdf = pdfContentStreams(result.bytes);

    expect(pdf).toContain('2.5 w');
    expect(pdf).toMatch(/0 0 1 SCN/);
    expect(pdf).toContain('\nS\n');
  });

  test('discloses Arial, Times New Roman, and Calibri substitutions but not Helvetica', async () => {
    const arial = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan({ x: 72, y: 680, width: 40, height: 12 }, 688, 'A', resolvedStyle('Arial')),
        pdfTextSpan({ x: 120, y: 680, width: 40, height: 12 }, 688, 'B', resolvedStyle('Arial')),
      ])
    );
    const times = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan(
          { x: 72, y: 680, width: 40, height: 12 },
          688,
          'T',
          resolvedStyle('Times New Roman')
        ),
      ])
    );
    const helvetica = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan({ x: 72, y: 680, width: 40, height: 12 }, 688, 'H', resolvedStyle('Helvetica')),
      ])
    );
    const calibri = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan({ x: 72, y: 680, width: 40, height: 12 }, 688, 'C', resolvedStyle('Calibri')),
      ])
    );

    expect(arial.diagnostics).toHaveLength(2);
    expect(arial.diagnostics).toContainEqual(
      expect.objectContaining({
        feature: 'shaped-glyph-run',
        reason: expect.stringContaining('independently reshapes and positions'),
      })
    );
    expect(arial.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: 'approximation',
        feature: 'standard-font-substitution',
        recordId: 'Arial',
        reason: 'Substituted PDF built-in font Helvetica for "Arial" (2 occurrences)',
      })
    );
    expect(times.diagnostics).toContainEqual(
      expect.objectContaining({
        kind: 'approximation',
        recordId: 'Times New Roman',
        reason: 'Substituted PDF built-in font Times-Roman for "Times New Roman"',
      })
    );
    expect(helvetica.diagnostics).toContainEqual(
      expect.objectContaining({ feature: 'shaped-glyph-run' })
    );
    expect(calibri.diagnostics).toContainEqual(
      expect.objectContaining({
        recordId: 'Calibri',
        reason: 'Substituted PDF built-in font Helvetica for "Calibri"',
      })
    );
  });

  test('stops collecting chunks when the output-byte cap is exceeded', async () => {
    const plan = createPdfPaintPlan([
      pdfBeginPage(0, 612, 792),
      pdfFillRect({ x: 0, y: 0, width: 612, height: 792 }, '#FFFFFF'),
      pdfTextSpan({ x: 72, y: 680, width: 120, height: 12 }, 688, 'Hello PDF', sampleStyle),
    ]);
    await expect(writePdfPaintPlanToBytes(plan, { maxOutputBytes: 32 })).rejects.toBeInstanceOf(
      PdfPaintValidationError
    );
    await expect(writePdfPaintPlanToBytes(plan, { maxOutputBytes: 32 })).rejects.toThrow(
      /outputBytes/
    );
  });

  test('rejects an output-byte cap above HARD_MAX_OUTPUT_BYTES before encoding', async () => {
    const plan = createPdfPaintPlan([pdfBeginPage(0, 612, 792)]);
    await expect(
      writePdfPaintPlanToBytes(plan, { maxOutputBytes: HARD_MAX_OUTPUT_BYTES + 1 })
    ).rejects.toBeInstanceOf(PdfPaintValidationError);
  });

  test('aborts after encoding starts and recovers on a later write', async () => {
    const commands: PdfPaintCommand[] = [pdfBeginPage(0, 612, 792)];
    for (let index = 0; index < 400; index += 1) {
      commands.push(
        pdfTextSpan({ x: 72, y: 680, width: 40, height: 12 }, 688, `n${index}`, sampleStyle)
      );
    }
    const plan = createPdfPaintPlan(commands);
    const controller = new AbortController();
    const pending = writePdfPaintPlanToBytes(plan, { signal: controller.signal });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort('cancel-after-start');
    const error = await pending.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExportResourceError);
    expect(error).toMatchObject({ code: 'aborted', cause: 'cancel-after-start' });

    const recovered = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan({ x: 72, y: 680, width: 40, height: 12 }, 688, 'ok', sampleStyle),
      ])
    );
    expect(recovered.pageCount).toBe(1);
    expect(recovered.bytes.byteLength).toBeGreaterThan(0);
  });

  test('rejects a synchronous paint error and recovers on a later write', async () => {
    const invalidCommand = Object.freeze({ kind: 'invalid-command' }) as unknown as PdfPaintCommand;
    const invalidPlan = createPdfPaintPlan([pdfBeginPage(0, 612, 792), invalidCommand]);

    await expect(writePdfPaintPlanToBytes(invalidPlan)).rejects.toThrow(
      'Unsupported PDF paint command kind: invalid-command'
    );

    const recovered = await writePdfPaintPlanToBytes(
      createPdfPaintPlan([
        pdfBeginPage(0, 612, 792),
        pdfTextSpan({ x: 72, y: 680, width: 40, height: 12 }, 688, 'ok', sampleStyle),
      ])
    );
    expect(recovered.pageCount).toBe(1);
    expect(recovered.bytes.byteLength).toBeGreaterThan(0);
  }, 1_000);

  test('does not apply style baseline shift on top of an already shifted command baseline', async () => {
    const pageHeight = 792;
    const shiftedBaseline = coreYToPdfY(108, pageHeight);
    const shiftedStyle = pdfTextStyleFromResolvedRunStyle({
      fontFamily: 'Helvetica',
      fontFamilyEastAsia: null,
      fontSizePt: 12,
      color: '000000',
      bold: false,
      italic: false,
      underline: null,
      strike: false,
      doubleStrike: false,
      highlight: null,
      shading: null,
      verticalAlign: 'baseline',
      baselineShiftPt: 4,
      caps: false,
      smallCaps: false,
      characterSpacingPt: 0,
      horizontalScalePercent: 100,
      kerningMinPt: 0,
      hidden: false,
    });
    const plan = createPdfPaintPlan([
      pdfBeginPage(0, 612, pageHeight),
      pdfTextSpan(
        coreBoxToPdfRect({ x: 72, y: 96, width: 120, height: 12 }, pageHeight),
        shiftedBaseline,
        'Shifted',
        shiftedStyle
      ),
    ]);
    const pdf = pdfContentStreams((await writePdfPaintPlanToBytes(plan)).bytes);
    expect(pdf).toMatch(/1 0 0 1 72 684(\.?\d*)? Tm/);
    expect(pdf).not.toMatch(/1 0 0 1 72 688(\.?\d*)? Tm/);
  });

  test('emits named destinations and internal GoTo links', async () => {
    const plan = createPdfPaintPlan([
      pdfBeginPage(0, 612, 792),
      pdfDestination('Jump', { x: 72, y: 700, width: 1, height: 12 }),
      pdfInternalLink({ x: 72, y: 600, width: 40, height: 12 }, 'Jump'),
    ]);
    const pdf = pdfLatin1((await writePdfPaintPlanToBytes(plan)).bytes);
    expect(pdf).toContain('/Subtype /Link');
    expect(pdf).toContain('/S /GoTo');
    expect(pdf).toContain('Jump');
    expect(pdf).not.toContain('/URI');
  });

  test('writes mixed-page destinations using each page MediaBox', async () => {
    const plan = createPdfPaintPlan([
      pdfBeginPage(0, 612, 792),
      pdfInternalLink({ x: 72, y: 700, width: 40, height: 12 }, 'Other'),
      pdfBeginPage(1, 841.89, 595.28),
      pdfDestination('Other', { x: 56.69, y: 526.59, width: 1, height: 12 }),
    ]);
    const result = await writePdfPaintPlanToBytes(plan);
    const pdf = pdfLatin1(result.bytes);
    expect(result.pageCount).toBe(2);
    expect(extractMediaBoxes(pdf)).toEqual([
      [0, 0, 612, 792],
      [0, 0, 841.89, 595.28],
    ]);
    expect(pdf).toContain('/S /GoTo');
    expect(pdf).toContain('Other');
  });

  test('maps document metadata into Info while keeping fixed producer and dates', async () => {
    const plan = createPdfPaintPlan([pdfBeginPage(0, 612, 792)], {
      title: 'Export Title',
      author: 'Export Author',
      subject: 'Export Subject',
      keywords: 'alpha, beta',
    });
    const first = await writePdfPaintPlanToBytes(plan);
    const second = await writePdfPaintPlanToBytes(plan);
    const pdf = pdfLatin1(first.bytes);
    expect(first.bytes).toEqual(second.bytes);
    expect(pdf).toContain('Export Title');
    expect(pdf).toContain('Export Author');
    expect(pdf).toContain('Export Subject');
    expect(pdf).toContain('alpha, beta');
    expect(pdf).toContain('docx-editor.dev');
    expect(pdf).toContain('D:20200101000000Z');
    expect(pdf).not.toContain('PDFKit');
  });
});

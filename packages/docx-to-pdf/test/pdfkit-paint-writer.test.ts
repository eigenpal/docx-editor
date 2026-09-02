import { describe, expect, test } from 'bun:test';
import { ExportResourceError } from '@docx-editor.dev/core/export';
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

function pdfLatin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

function extractMediaBoxes(pdf: string): number[][] {
  return [...pdf.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map((match) =>
    match[1]!.trim().split(/\s+/).map(Number)
  );
}

function utf8HexLower(text: string): string {
  return Buffer.from(text, 'utf8').toString('hex').toLowerCase();
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

  test('encodes text spans with extractable Unicode in content streams', async () => {
    const pageHeight = 792;
    const baseline = coreYToPdfY(108, pageHeight);
    const plan = createPdfPaintPlan([
      pdfBeginPage(0, 612, pageHeight),
      pdfTextSpan(
        coreBoxToPdfRect({ x: 72, y: 96, width: 120, height: 12 }, pageHeight),
        baseline,
        'Hello PDF',
        sampleStyle
      ),
    ]);

    const result = await writePdfPaintPlanToBytes(plan);
    const pdf = pdfLatin1(result.bytes);
    const hex = utf8HexLower('Hello PDF');

    expect(pdf).toContain(`<${hex}>`);
    expect(pdf).toMatch(/1 0 0 1 72 684(\.?\d*)? Tm/);
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
    const pdf = pdfLatin1(result.bytes);

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
    const pdf = pdfLatin1(result.bytes);

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

    expect(arial.diagnostics).toHaveLength(1);
    expect(arial.diagnostics[0]).toMatchObject({
      kind: 'approximation',
      feature: 'standard-font-substitution',
      recordId: 'Arial',
      reason: 'Substituted PDF built-in font Helvetica for "Arial" (2 occurrences)',
    });
    expect(times.diagnostics[0]).toMatchObject({
      kind: 'approximation',
      recordId: 'Times New Roman',
      reason: 'Substituted PDF built-in font Times-Roman for "Times New Roman"',
    });
    expect(helvetica.diagnostics).toEqual([]);
    expect(calibri.diagnostics[0]).toMatchObject({
      recordId: 'Calibri',
      reason: 'Substituted PDF built-in font Helvetica for "Calibri"',
    });
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
    const pdf = pdfLatin1((await writePdfPaintPlanToBytes(plan)).bytes);
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

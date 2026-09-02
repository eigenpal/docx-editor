import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineFontResolver, type FontResolutionRequest } from '@docx-editor.dev/core/editor';
import {
  ExportResourceError,
  exportPdf,
  HARD_MAX_FIDELITY_DIAGNOSTICS,
  HARD_MAX_OUTPUT_BYTES,
  PdfDocumentOpenError,
  PdfFidelityError,
  PdfPaintValidationError,
} from '../src/index.ts';
import { docx } from './fixture.ts';

const exportSource = readFileSync(join(import.meta.dir, '..', 'src', 'pdf-export.ts'), 'utf8');

function pdfLatin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

function pdfContainsText(bytes: Uint8Array, text: string): boolean {
  const pdf = pdfLatin1(bytes);
  const hex = Buffer.from(text, 'utf8').toString('hex').toLowerCase();
  if (pdf.toLowerCase().includes(`<${hex}>`)) return true;
  const payloads = [...pdf.matchAll(/<([0-9A-Fa-f]+)>/g)]
    .map((match) => match[1].toLowerCase())
    .filter((payload) => payload.length <= 256)
    .join('');
  return payloads.includes(hex);
}

const helloDocx = (): Uint8Array => docx('<w:p><w:r><w:t>Hello PDF</w:t></w:r></w:p>');

describe('one-shot exportPdf', () => {
  test('writes valid PDF bytes, page count, and packaged font evidence', async () => {
    const result = await exportPdf(helloDocx());
    const pdf = pdfLatin1(result.bytes);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toContain('%%EOF');
    expect(result.pageCount).toBe(1);
    expect((pdf.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(1);
    expect(pdfContainsText(result.bytes, 'Hello PDF')).toBe(true);
    expect(result.layoutRevision).toEqual(expect.any(Number));
    expect(result.displayMode).toBe('all-markup');
    expect(result.fontResolution).toMatchObject({
      defaultFamily: 'Calibri',
      originFailures: [],
    });
    expect(
      result.fontResolution.families.some(
        (family) => family.family === 'Calibri' && family.coverage === 'complete'
      )
    ).toBe(true);
    const shaped = result.diagnostics.find(
      (diagnostic) => diagnostic.feature === 'shaped-glyph-run'
    );
    expect(shaped).toMatchObject({
      kind: 'approximation',
      recordKind: 'styleSpan',
    });
    expect(shaped?.reason).toContain('PDFKit reshapes Unicode text');
    expect(shaped?.reason).toContain('not encoded');
    expect(result.diagnostics.length).toBeLessThanOrEqual(HARD_MAX_FIDELITY_DIAGNOSTICS);
  });

  test('preserves Core all-markup as the default revision projection', async () => {
    const bytes = docx(
      '<w:p><w:del w:id="1" w:author="A"><w:r><w:delText>Old</w:delText></w:r></w:del>' +
        '<w:ins w:id="2" w:author="A"><w:r><w:t>New</w:t></w:r></w:ins></w:p>'
    );
    const implicit = await exportPdf(bytes);
    const markup = await exportPdf(bytes, { displayMode: 'all-markup' });
    const proposed = await exportPdf(bytes, { displayMode: 'proposed' });
    const original = await exportPdf(bytes, { displayMode: 'original' });

    expect(implicit.displayMode).toBe('all-markup');
    expect(markup.displayMode).toBe('all-markup');
    expect(proposed.displayMode).toBe('proposed');
    expect(original.displayMode).toBe('original');
    expect(pdfContainsText(implicit.bytes, 'Old')).toBe(true);
    expect(pdfContainsText(implicit.bytes, 'New')).toBe(true);
    expect(pdfContainsText(markup.bytes, 'Old')).toBe(true);
    expect(pdfContainsText(markup.bytes, 'New')).toBe(true);
    expect(pdfContainsText(proposed.bytes, 'Old')).toBe(false);
    expect(pdfContainsText(proposed.bytes, 'New')).toBe(true);
    expect(pdfContainsText(original.bytes, 'Old')).toBe(true);
    expect(pdfContainsText(original.bytes, 'New')).toBe(false);
  });

  test('strict fidelity refuses visible approximations and unsupported records', async () => {
    const error = await exportPdf(helloDocx(), { fidelityPolicy: 'strict' }).catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(PdfFidelityError);
    expect((error as PdfFidelityError).diagnostics.length).toBeGreaterThan(0);
    expect(
      (error as PdfFidelityError).diagnostics.some(
        (diagnostic) => diagnostic.kind === 'approximation' || diagnostic.kind === 'unsupported'
      )
    ).toBe(true);
  });

  test('preserves structured DOCX open failures', async () => {
    const error = await exportPdf(new Uint8Array([1, 2, 3])).catch((caught) => caught);
    expect(error).toBeInstanceOf(PdfDocumentOpenError);
    expect(error).toMatchObject({ reason: 'inflate-error' });
  });

  test('pre-aborted export is an aborted resource error and returns no bytes', async () => {
    const controller = new AbortController();
    controller.abort('cancel-before-open');
    const error = await exportPdf(helloDocx(), { signal: controller.signal }).catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(ExportResourceError);
    expect(error).toMatchObject({ code: 'aborted', cause: 'cancel-before-open' });
  });

  test('cancellation during font loading stays an aborted resource error', async () => {
    const controller = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const pending = exportPdf(helloDocx(), {
      signal: controller.signal,
      fonts: defineFontResolver(
        (request: FontResolutionRequest) =>
          new Promise<undefined>((resolve) => {
            markStarted?.();
            request.signal?.addEventListener('abort', () => resolve(undefined), { once: true });
          })
      ),
    });
    await started;
    controller.abort('cancel-during-fonts');
    const error = await pending.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExportResourceError);
    expect(error).toMatchObject({ code: 'aborted', cause: 'cancel-during-fonts' });
  });

  test('disposes the Core session after success, refusal, abort, and invalid input', async () => {
    await expect(exportPdf(helloDocx())).resolves.toMatchObject({ pageCount: 1 });
    await expect(exportPdf(helloDocx(), { fidelityPolicy: 'strict' })).rejects.toBeInstanceOf(
      PdfFidelityError
    );
    await expect(exportPdf(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(PdfDocumentOpenError);

    const controller = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const pending = exportPdf(helloDocx(), {
      signal: controller.signal,
      fonts: defineFontResolver(
        (request: FontResolutionRequest) =>
          new Promise<undefined>((resolve) => {
            markStarted?.();
            request.signal?.addEventListener('abort', () => resolve(undefined), { once: true });
          })
      ),
    });
    await started;
    controller.abort('dispose-after-abort');
    await expect(pending).rejects.toBeInstanceOf(ExportResourceError);

    const recovered = await exportPdf(helloDocx());
    expect(recovered.pageCount).toBe(1);
    expect(recovered.fontResolution.originFailures).toEqual([]);
  });

  test('caller fonts precede packaged defaults and opt-in fallback origins', async () => {
    const calls: { caller?: FontResolutionRequest; fallback?: FontResolutionRequest } = {};
    const caller = defineFontResolver((request: FontResolutionRequest) => {
      calls.caller = request;
      return undefined;
    });
    const fallback = defineFontResolver((request: FontResolutionRequest) => {
      calls.fallback = request;
      return undefined;
    });
    const bytes = docx(
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="Roboto" w:hAnsi="Roboto"/></w:rPr><w:t>Fonts</w:t></w:r></w:p>'
    );

    const result = await exportPdf(bytes, { fonts: caller, fallbackFonts: fallback });
    expect(calls.caller?.families).toEqual(['Roboto']);
    expect(calls.caller?.resolvedFaces).toBeUndefined();
    expect(calls.fallback?.families).toEqual(['Roboto']);
    expect(calls.fallback?.resolvedFaces?.some((face) => face.family === 'Calibri')).toBe(true);
    expect(calls.fallback?.resolvedFaces?.some((face) => face.family === 'Carlito')).toBe(true);
    expect(result.pageCount).toBe(1);
  });

  test('refuses a maxOutputBytes value outside the hard cap', async () => {
    await expect(
      exportPdf(helloDocx(), { maxOutputBytes: HARD_MAX_OUTPUT_BYTES + 1 })
    ).rejects.toBeInstanceOf(PdfPaintValidationError);
    await expect(exportPdf(helloDocx(), { maxOutputBytes: 0 })).rejects.toBeInstanceOf(
      PdfPaintValidationError
    );
  });

  test('discloses the standard-font substitution used for Hello PDF text', async () => {
    const result = await exportPdf(helloDocx());
    const substitution = result.diagnostics.find(
      (diagnostic) => diagnostic.feature === 'standard-font-substitution'
    );
    expect(substitution).toMatchObject({
      kind: 'approximation',
    });
    expect(substitution?.reason).toContain('Helvetica');
    expect(substitution?.recordId === 'Helvetica').toBe(false);
  });

  test('identical inputs produce identical PDF bytes', async () => {
    const source = helloDocx();
    const first = await exportPdf(source);
    const second = await exportPdf(source);
    expect(first.bytes).toEqual(second.bytes);
    expect(first.pageCount).toBe(second.pageCount);
    expect(first.diagnostics).toEqual(second.diagnostics);
  });

  test('aggregates repeated laid-out text approximations under the diagnostic cap', async () => {
    const paragraphs = Array.from(
      { length: 12 },
      () => '<w:p><w:r><w:t>Hello PDF</w:t></w:r></w:p>'
    ).join('');
    const result = await exportPdf(docx(paragraphs));
    const shaped = result.diagnostics.filter(
      (diagnostic) => diagnostic.feature === 'shaped-glyph-run'
    );
    expect(shaped).toHaveLength(1);
    expect(shaped[0]?.reason).toContain('occurrences');
    expect(result.diagnostics.length).toBeLessThanOrEqual(HARD_MAX_FIDELITY_DIAGNOSTICS);
  });

  test('aborts during encoding and recovers on a later export', async () => {
    const paragraphs = Array.from(
      { length: 400 },
      (_, index) => `<w:p><w:r><w:t>P${index}</w:t></w:r></w:p>`
    ).join('');
    const controller = new AbortController();
    const pending = exportPdf(docx(paragraphs), { signal: controller.signal });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort('cancel-during-encoding');
    const error = await pending.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExportResourceError);
    expect(error).toMatchObject({ code: 'aborted', cause: 'cancel-during-encoding' });

    const recovered = await exportPdf(helloDocx());
    expect(recovered.pageCount).toBe(1);
    expect(recovered.bytes.byteLength).toBeGreaterThan(0);
  });

  test('keeps the font-backed session alive through planning and encoding', () => {
    const oneShot = exportSource.slice(exportSource.indexOf('export async function exportPdf('));
    expect(exportSource).toContain('session.shapeLaidOutText(visit.span)');
    expect(oneShot).toContain('createFidelityDiagnosticCollector()');
    expect(oneShot).toContain('recordLaidOutTextFidelity(layout, opened.session, diagnostics)');
    expect(oneShot).toContain('planPdfPaintFromLayout(layout, { signal: options.signal })');
    expect(oneShot).toContain('writePdfPaintPlanToBytes(planned.plan');
    expect(oneShot).not.toMatch(/\.\.\.written\.diagnostics/);
    expect(oneShot).not.toMatch(/\.\.\.planned\.diagnostics/);
    expect(
      oneShot.indexOf('planPdfPaintFromLayout(layout, { signal: options.signal })')
    ).toBeLessThan(oneShot.indexOf('opened.session.dispose()'));
    expect(oneShot.indexOf('writePdfPaintPlanToBytes(planned.plan')).toBeLessThan(
      oneShot.indexOf('opened.session.dispose()')
    );
    expect(
      oneShot.indexOf('recordLaidOutTextFidelity(layout, opened.session, diagnostics)')
    ).toBeLessThan(oneShot.indexOf('opened.session.dispose()'));
    expect(oneShot.indexOf('try {')).toBeLessThan(
      oneShot.indexOf('planPdfPaintFromLayout(layout, { signal: options.signal })')
    );
    expect(oneShot).toMatch(/\} finally \{\s*opened\.session\.dispose\(\);/);
  });
});

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import PDFDocument from 'pdfkit';
import { ExportResourceError } from '@docx-editor.dev/core/export';
import {
  createFidelityDiagnosticCollector,
  pdfApproximationDiagnostic,
  pdfUnsupportedDiagnostic,
} from './pdf-fidelity-diagnostics.ts';
import type {
  PdfAdmittedFont,
  PdfPaintWriteOptions,
  PdfPaintWriterPort,
  PdfPaintWriterResult,
} from './pdf-paint-writer-port.ts';
import type {
  PdfDocumentMetadata,
  PdfPaintCommand,
  PdfPaintPlan,
  PdfRect,
} from './pdf-paint-types.ts';
import type { PdfTextStyle } from './pdf-text-style.ts';
import {
  HARD_MAX_OUTPUT_BYTES,
  PdfPaintValidationError,
  validateOutputByteLimit,
} from './pdf-paint-bounds.ts';
import { isWinAnsiRepresentable } from './pdf-winansi-encoding.ts';

const DETERMINISTIC_PDF_INFO: PDFKit.DocumentInfo = Object.freeze({
  Producer: 'docx-editor.dev',
  Creator: 'docx-editor.dev',
  CreationDate: new Date('2020-01-01T00:00:00.000Z'),
  ModDate: new Date('2020-01-01T00:00:00.000Z'),
});

const COMMAND_YIELD_BATCH_SIZE = 256;

type StandardFontBase = 'Helvetica' | 'Times-Roman' | 'Courier';

interface PdfKitRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface ResolvedStandardFont {
  readonly pdfkitName: string;
  readonly base: StandardFontBase;
  readonly requested: string;
  readonly recordId: string | null;
  readonly exactBuiltIn: boolean;
}

interface ResolvedEmbeddedFont {
  readonly font: PdfAdmittedFont;
  readonly key: string;
}

type FontEmbeddingDecision =
  | { readonly kind: 'embed' }
  | { readonly kind: 'refuse'; readonly reason: string };

function readUint16(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset > bytes.byteLength - 2) return null;
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUint32(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset > bytes.byteLength - 4) return null;
  return (
    (bytes[offset]! * 0x1000000 +
      (bytes[offset + 1]! << 16) +
      (bytes[offset + 2]! << 8) +
      bytes[offset + 3]!) >>>
    0
  );
}

function isFontCollection(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) === 'ttcf'
  );
}

function fontEmbeddingDecision(font: PdfAdmittedFont): FontEmbeddingDecision {
  const { bytes, faceIndex } = font;
  if (isFontCollection(bytes)) {
    return {
      kind: 'refuse',
      reason:
        'PDFKit exposes a collection family selector, but Core does not expose the selected face name needed to prove faceIndex selection',
    };
  }
  if (faceIndex !== 0) {
    return {
      kind: 'refuse',
      reason: 'A nonzero faceIndex requires a TrueType collection resource',
    };
  }

  const base = 0;
  const tableCount = readUint16(bytes, base + 4);
  if (tableCount === null || tableCount > 4096) {
    return { kind: 'refuse', reason: 'The admitted font has no bounded SFNT table directory' };
  }
  const directoryEnd = base + 12 + tableCount * 16;
  if (!Number.isSafeInteger(directoryEnd) || directoryEnd > bytes.byteLength) {
    return { kind: 'refuse', reason: 'The admitted font has a truncated SFNT table directory' };
  }
  for (let index = 0; index < tableCount; index += 1) {
    const record = base + 12 + index * 16;
    const tag = String.fromCharCode(
      bytes[record]!,
      bytes[record + 1]!,
      bytes[record + 2]!,
      bytes[record + 3]!
    );
    if (tag !== 'OS/2') continue;
    const offset = readUint32(bytes, record + 8);
    const length = readUint32(bytes, record + 12);
    if (
      offset === null ||
      length === null ||
      offset > bytes.byteLength ||
      length > bytes.byteLength - offset ||
      length < 10
    ) {
      return { kind: 'refuse', reason: 'The admitted font has an invalid OS/2 table range' };
    }
    const fsType = readUint16(bytes, offset + 8);
    if (fsType === null) {
      return { kind: 'refuse', reason: 'The admitted font has a truncated OS/2 fsType value' };
    }
    if ((fsType & 0x0002) !== 0) {
      return { kind: 'refuse', reason: 'The OS/2 fsType forbids font embedding' };
    }
    if ((fsType & 0x0100) !== 0) {
      return {
        kind: 'refuse',
        reason:
          'The OS/2 fsType forbids subsetting, and PDFKit has no safe full-font embedding mode',
      };
    }
    return { kind: 'embed' };
  }
  return { kind: 'embed' };
}

function pdfRectToPdfKit(rect: PdfRect, pageHeight: number): PdfKitRect {
  return Object.freeze({
    x: rect.x,
    y: pageHeight - rect.y - rect.height,
    width: rect.width,
    height: rect.height,
  });
}

function baselineToPdfKitY(baseline: number, pageHeight: number): number {
  return pageHeight - baseline;
}

function fontToken(family: string | null): string {
  return (family ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function variantName(base: StandardFontBase, bold: boolean, italic: boolean): string {
  if (base === 'Helvetica') {
    if (bold && italic) return 'Helvetica-BoldOblique';
    if (bold) return 'Helvetica-Bold';
    if (italic) return 'Helvetica-Oblique';
    return 'Helvetica';
  }
  if (base === 'Times-Roman') {
    if (bold && italic) return 'Times-BoldItalic';
    if (bold) return 'Times-Bold';
    if (italic) return 'Times-Italic';
    return 'Times-Roman';
  }
  if (bold && italic) return 'Courier-BoldOblique';
  if (bold) return 'Courier-Bold';
  if (italic) return 'Courier-Oblique';
  return 'Courier';
}

function isExactBuiltIn(token: string, base: StandardFontBase): boolean {
  if (base === 'Helvetica') return token === 'helvetica';
  if (base === 'Times-Roman') return token === 'timesroman' || token === 'times';
  return token === 'courier';
}

function resolveStandardFont(style: PdfTextStyle): ResolvedStandardFont {
  const trimmed = style.fontFamily?.trim() ?? '';
  const requested = trimmed.length > 0 ? trimmed : 'unspecified';
  const recordId = trimmed.length > 0 ? trimmed : null;
  const token = fontToken(style.fontFamily);
  let base: StandardFontBase = 'Helvetica';
  if (
    token === 'times' ||
    token === 'timesroman' ||
    token === 'timesnewroman' ||
    token === 'georgia' ||
    token === 'cambria' ||
    token === 'garamond' ||
    token === 'serif'
  ) {
    base = 'Times-Roman';
  } else if (
    token === 'courier' ||
    token === 'mono' ||
    token === 'consolas' ||
    token === 'menlo' ||
    token === 'monospace' ||
    token.includes('courier')
  ) {
    base = 'Courier';
  }
  return Object.freeze({
    pdfkitName: variantName(base, style.fontWeight === 'bold', style.italic),
    base,
    requested,
    recordId,
    exactBuiltIn: isExactBuiltIn(token, base),
  });
}

function fontRequestMatches(
  style: PdfTextStyle,
  defaultFontFamily: string | undefined,
  font: PdfAdmittedFont
): boolean {
  return (
    fontToken(font.request.family) === fontToken(style.fontFamily ?? defaultFontFamily ?? null) &&
    font.request.weight === (style.fontWeight === 'bold' ? 700 : 400) &&
    font.request.style === (style.italic ? 'italic' : 'normal')
  );
}

function resolveEmbeddedFont(
  style: PdfTextStyle,
  admittedFonts: readonly PdfAdmittedFont[],
  defaultFontFamily: string | undefined
): ResolvedEmbeddedFont | null {
  for (const font of admittedFonts) {
    if (!fontRequestMatches(style, defaultFontFamily, font)) continue;
    return Object.freeze({ font, key: `docx-editor:${font.identity}` });
  }
  return null;
}

function textColorOf(style: PdfTextStyle): string {
  return style.color ?? '#000000';
}

function pdfDocumentInfo(metadata: PdfDocumentMetadata | undefined): PDFKit.DocumentInfo {
  const info: PDFKit.DocumentInfo = {
    Producer: DETERMINISTIC_PDF_INFO.Producer,
    Creator: DETERMINISTIC_PDF_INFO.Creator,
    CreationDate: DETERMINISTIC_PDF_INFO.CreationDate,
    ModDate: DETERMINISTIC_PDF_INFO.ModDate,
  };
  if (metadata?.title) info.Title = metadata.title;
  if (metadata?.author) info.Author = metadata.author;
  if (metadata?.subject) info.Subject = metadata.subject;
  if (metadata?.keywords) info.Keywords = metadata.keywords;
  return info;
}

function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (!signal?.aborted) return;
  throw new ExportResourceError('aborted', message, { cause: signal.reason });
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function closePdfDocument(doc: PDFKit.PDFDocument): void {
  try {
    doc.removeAllListeners();
  } catch {
    // Cleanup must not hide the original encoding or abort error.
  }
  try {
    const destroyable = doc as PDFKit.PDFDocument & { destroy?: () => void };
    if (typeof destroyable.destroy === 'function') {
      destroyable.destroy();
      return;
    }
    doc.end();
  } catch {
    // Cleanup must not hide the original encoding or abort error.
  }
}

interface ByteCollector {
  readonly bytes: Promise<Uint8Array>;
  dispose(error?: unknown): void;
}

function collectPdfBytes(
  doc: PDFKit.PDFDocument,
  maxOutputBytes: number,
  signal: AbortSignal | undefined
): ByteCollector {
  const chunks: Buffer[] = [];
  let total = 0;
  let settled = false;
  let abortHandler: (() => void) | undefined;
  let rejectPending: ((reason?: unknown) => void) | undefined;
  let dataHandler: ((chunk: Buffer) => void) | undefined;
  let endHandler: (() => void) | undefined;
  let errorHandler: ((error: unknown) => void) | undefined;

  const removeListeners = (): void => {
    if (abortHandler && signal) {
      signal.removeEventListener('abort', abortHandler);
    }
    if (dataHandler) doc.off('data', dataHandler);
    if (endHandler) doc.off('end', endHandler);
    if (errorHandler) doc.off('error', errorHandler);
  };

  const finish = (action: () => void): void => {
    if (settled) return;
    settled = true;
    removeListeners();
    action();
    chunks.length = 0;
    total = 0;
  };

  const bytes = new Promise<Uint8Array>((resolve, reject) => {
    rejectPending = reject;

    abortHandler = (): void => {
      finish(() => {
        reject(
          new ExportResourceError('aborted', 'PDF encoding was aborted', { cause: signal?.reason })
        );
        closePdfDocument(doc);
      });
    };

    dataHandler = (chunk: Buffer): void => {
      if (settled) return;
      const size = chunk.byteLength;
      if (total + size > maxOutputBytes) {
        finish(() => {
          reject(
            new PdfPaintValidationError('outputBytes', `must be at most ${maxOutputBytes} bytes`)
          );
          closePdfDocument(doc);
        });
        return;
      }
      total += size;
      chunks.push(chunk);
    };

    endHandler = (): void => {
      finish(() => {
        resolve(new Uint8Array(Buffer.concat(chunks)));
      });
    };

    errorHandler = (error: unknown): void => {
      finish(() => reject(error));
    };

    doc.on('data', dataHandler);
    doc.on('end', endHandler);
    doc.on('error', errorHandler);

    if (signal) {
      if (signal.aborted) {
        abortHandler();
        return;
      }
      signal.addEventListener('abort', abortHandler, { once: true });
    }
  });

  return {
    bytes,
    dispose(error: unknown = new Error('PDF byte collection was disposed')): void {
      finish(() => rejectPending?.(error));
    },
  };
}

function paintTextDecoration(
  doc: PDFKit.PDFDocument,
  command: Extract<PdfPaintCommand, { kind: 'textSpan' }>,
  y: number
): void {
  const { decoration, fontSizePt } = command.style;
  if (decoration === 'none') return;
  const x = command.rect.x;
  const right = x + command.rect.width;
  if (!(right > x)) return;
  const lineWidth = Math.max(0.5, fontSizePt / 18);
  const color = textColorOf(command.style);
  const stroke = (offset: number): void => {
    doc
      .lineWidth(lineWidth)
      .strokeColor(color)
      .moveTo(x, y + offset)
      .lineTo(right, y + offset)
      .stroke();
  };
  if (decoration === 'underline') {
    stroke(Math.max(1, fontSizePt * 0.08));
    return;
  }
  if (decoration === 'strike') {
    stroke(-fontSizePt * 0.3);
    return;
  }
  stroke(-fontSizePt * 0.22);
  stroke(-fontSizePt * 0.4);
}

function paintCommand(
  doc: PDFKit.PDFDocument,
  command: PdfPaintCommand,
  page: { height: number; index: number; open: boolean },
  diagnostics: { push(diagnostic: ReturnType<typeof pdfUnsupportedDiagnostic>): void },
  admittedFonts: readonly PdfAdmittedFont[],
  defaultFontFamily: string | undefined,
  registeredFonts: Map<string, FontEmbeddingDecision>
): { height: number; index: number; open: boolean; pageCountDelta: number } {
  switch (command.kind) {
    case 'beginPage': {
      doc.addPage({
        size: [command.width, command.height],
        margin: 0,
      });
      return {
        height: command.height,
        index: command.pageIndex,
        open: true,
        pageCountDelta: 1,
      };
    }
    case 'saveState': {
      if (!page.open) throw new Error('PDF paint command requires beginPage before page content');
      doc.save();
      return { ...page, pageCountDelta: 0 };
    }
    case 'restoreState': {
      if (!page.open) throw new Error('PDF paint command requires beginPage before page content');
      doc.restore();
      return { ...page, pageCountDelta: 0 };
    }
    case 'clipRect': {
      if (!page.open) throw new Error('PDF paint command requires beginPage before page content');
      const rect = pdfRectToPdfKit(command.rect, page.height);
      doc.rect(rect.x, rect.y, rect.width, rect.height).clip();
      return { ...page, pageCountDelta: 0 };
    }
    case 'fillRect': {
      if (!page.open) throw new Error('PDF paint command requires beginPage before page content');
      const rect = pdfRectToPdfKit(command.rect, page.height);
      doc.fillColor(command.color).rect(rect.x, rect.y, rect.width, rect.height).fill();
      return { ...page, pageCountDelta: 0 };
    }
    case 'strokeRect': {
      if (!page.open) throw new Error('PDF paint command requires beginPage before page content');
      const rect = pdfRectToPdfKit(command.rect, page.height);
      doc
        .lineWidth(command.lineWidth)
        .strokeColor(command.color)
        .rect(rect.x, rect.y, rect.width, rect.height)
        .stroke();
      return { ...page, pageCountDelta: 0 };
    }
    case 'textSpan': {
      if (!page.open) throw new Error('PDF paint command requires beginPage before page content');
      const style = command.style;
      const embedded = resolveEmbeddedFont(style, admittedFonts, defaultFontFamily);
      const decision = embedded
        ? (registeredFonts.get(embedded.font.identity) ?? fontEmbeddingDecision(embedded.font))
        : null;
      if (embedded && decision && !registeredFonts.has(embedded.font.identity)) {
        registeredFonts.set(embedded.font.identity, decision);
      }
      const useEmbedded = embedded !== null && decision?.kind === 'embed';
      const mapped = useEmbedded ? null : resolveStandardFont(style);
      if (embedded && decision?.kind === 'refuse') {
        diagnostics.push(
          pdfUnsupportedDiagnostic({
            feature: 'font-embedding-permission',
            pageIndex: page.index,
            recordKind: 'textSpan',
            recordId: embedded.font.identity,
            reason: decision.reason,
          })
        );
      }
      if (!useEmbedded && !isWinAnsiRepresentable(command.text)) {
        diagnostics.push(
          pdfUnsupportedDiagnostic({
            feature: 'standard-font-encoding',
            pageIndex: page.index,
            recordKind: 'textSpan',
            recordId: mapped!.recordId,
            reason: `Text cannot be encoded with PDF built-in font WinAnsiEncoding for "${mapped!.requested}"`,
          })
        );
        return { ...page, pageCountDelta: 0 };
      }
      // Command baseline already includes Core baseline shift; do not apply style.baselineShiftPt again.
      const y = baselineToPdfKitY(command.baseline, page.height);
      if (useEmbedded) {
        if (!registeredFonts.has(embedded!.key)) {
          doc.registerFont(embedded!.key, Buffer.from(embedded!.font.bytes));
          registeredFonts.set(embedded!.key, { kind: 'embed' });
        }
        doc.font(embedded!.key);
      } else {
        doc.font(mapped!.pdfkitName);
      }
      doc.fontSize(style.fontSizePt).fillColor(textColorOf(style));
      const width = doc.widthOfString(command.text);
      const horizontalScaling =
        width > 0 && command.rect.width > 0 ? (command.rect.width / width) * 100 : undefined;
      doc.text(command.text, command.rect.x, y, {
        lineBreak: false,
        baseline: 'alphabetic',
        ...(horizontalScaling === undefined ? {} : { horizontalScaling }),
      });
      paintTextDecoration(doc, command, y);
      diagnostics.push(
        pdfApproximationDiagnostic({
          feature: 'shaped-glyph-run',
          pageIndex: page.index,
          recordKind: 'textSpan',
          recordId: useEmbedded ? embedded!.font.identity : mapped!.recordId,
          reason: useEmbedded
            ? 'PDFKit reshapes text from the exact Core-admitted font bytes; Core glyph IDs and positions are not encoded'
            : 'PDFKit independently reshapes and positions text with a PDF built-in font; Core glyph IDs and positions are not encoded',
        })
      );
      if (useEmbedded) {
      } else if (!mapped!.exactBuiltIn) {
        diagnostics.push(
          pdfApproximationDiagnostic({
            feature: 'standard-font-substitution',
            pageIndex: page.index,
            recordKind: 'textSpan',
            recordId: mapped!.recordId,
            reason: `Substituted PDF built-in font ${mapped!.base} for "${mapped!.requested}"`,
          })
        );
      }
      return { ...page, pageCountDelta: 0 };
    }
    case 'link': {
      if (!page.open) throw new Error('PDF paint command requires beginPage before page content');
      const rect = pdfRectToPdfKit(command.rect, page.height);
      if (command.target.kind === 'external') {
        doc.link(rect.x, rect.y, rect.width, rect.height, command.target.href);
      } else {
        doc.goTo(rect.x, rect.y, rect.width, rect.height, command.target.destination);
      }
      return { ...page, pageCountDelta: 0 };
    }
    case 'image': {
      if (!page.open) throw new Error('PDF paint command requires beginPage before page content');
      diagnostics.push(
        pdfUnsupportedDiagnostic({
          feature: 'image',
          pageIndex: page.index,
          recordKind: 'image',
          reason: `Image command "${command.imageId}" is not implemented in the PDFKit spike`,
        })
      );
      return { ...page, pageCountDelta: 0 };
    }
    case 'destination': {
      if (!page.open) throw new Error('PDF paint command requires beginPage before page content');
      const rect = pdfRectToPdfKit(command.rect, page.height);
      doc.addNamedDestination(command.name, 'XYZ', rect.x, rect.y, null);
      return { ...page, pageCountDelta: 0 };
    }
    default: {
      const unknown = command as PdfPaintCommand;
      throw new Error(`Unsupported PDF paint command kind: ${unknown.kind}`);
    }
  }
}

/** PDFKit-backed paint-plan writer for the task 1.4 spike. @internal */
export class PdfKitPaintWriter implements PdfPaintWriterPort {
  async write(
    plan: PdfPaintPlan,
    options: PdfPaintWriteOptions = {}
  ): Promise<PdfPaintWriterResult> {
    const maxOutputBytes = validateOutputByteLimit(options.maxOutputBytes ?? HARD_MAX_OUTPUT_BYTES);
    throwIfAborted(options.signal, 'PDF encoding was aborted');

    const diagnostics = createFidelityDiagnosticCollector();
    let pageCount = 0;
    let page = { height: 0, index: 0, open: false };
    const registeredFonts = new Map<string, FontEmbeddingDecision>();

    const doc = new PDFDocument({
      autoFirstPage: false,
      compress: true,
      margin: 0,
      info: pdfDocumentInfo(plan.documentMetadata),
    });
    const collector = collectPdfBytes(doc, maxOutputBytes, options.signal);
    void collector.bytes.catch(() => undefined);

    try {
      await yieldToEventLoop();
      throwIfAborted(options.signal, 'PDF encoding was aborted');

      for (let index = 0; index < plan.commands.length; index += 1) {
        if (index > 0 && index % COMMAND_YIELD_BATCH_SIZE === 0) {
          await yieldToEventLoop();
          throwIfAborted(options.signal, 'PDF encoding was aborted');
        }
        const next = paintCommand(
          doc,
          plan.commands[index]!,
          page,
          diagnostics,
          options.admittedFonts ?? [],
          options.defaultFontFamily,
          registeredFonts
        );
        pageCount += next.pageCountDelta;
        page = { height: next.height, index: next.index, open: next.open };
      }

      doc.end();
      const bytes = await collector.bytes;
      return Object.freeze({
        bytes,
        pageCount,
        diagnostics: diagnostics.snapshot(),
      });
    } catch (error) {
      collector.dispose(error);
      closePdfDocument(doc);
      await collector.bytes.catch(() => undefined);
      throw error;
    }
  }
}

/** Encodes one paint plan to deterministic PDF bytes using PDFKit. @internal */
export async function writePdfPaintPlanToBytes(
  plan: PdfPaintPlan,
  options: PdfPaintWriteOptions = {}
): Promise<PdfPaintWriterResult> {
  return new PdfKitPaintWriter().write(plan, options);
}

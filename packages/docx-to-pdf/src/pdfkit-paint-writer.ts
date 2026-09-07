/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { FontkitFont } from 'fontkit';
import PDFDocument from 'pdfkit';
import { ExportResourceError } from '@docx-editor.dev/core/export';
import {
  embeddedFaceCmap,
  fontEmbeddingDecision,
  type EmbeddedCmapCache,
  type FontEmbeddingDecision,
} from './pdf-font-embedding.ts';
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
import {
  PDF_STANDARD_UNDERLINE_METRICS,
  canMergeSingleUnderlineRuns,
  excludesTrailingUnderlineSpace,
  extendSingleUnderlineRun,
  gridRoundedSingleUnderlineGeometry,
  pdfSingleUnderlineGeometry,
  pdfUnderlineFillRect,
  pdfUnderlineLinkKey,
  pdfUnderlineMetricsFromSfnt,
  type PdfUnderlineMetrics,
  type PdfUnderlineSegment,
} from './pdf-underline-geometry.ts';

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

const MAX_REPORTED_MISSING_SCALARS = 8;
const VARIATION_SELECTOR_START = 0xfe00;
const VARIATION_SELECTOR_END = 0xfe0f;
const VARIATION_SELECTOR_SUPPLEMENT_START = 0xe0100;
const VARIATION_SELECTOR_SUPPLEMENT_END = 0xe01ef;
const ZERO_WIDTH_NON_JOINER = 0x200c;
const ZERO_WIDTH_JOINER = 0x200d;

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

function admittedFamilyKey(family: string | null | undefined): string {
  return (family ?? '').trim().toLowerCase();
}

function formatUnicodeScalar(scalar: number): string {
  return `U+${scalar.toString(16).toUpperCase().padStart(4, '0')}`;
}

function isInvisibleShapingControl(scalar: number): boolean {
  return (
    scalar === ZERO_WIDTH_JOINER ||
    scalar === ZERO_WIDTH_NON_JOINER ||
    (scalar >= VARIATION_SELECTOR_START && scalar <= VARIATION_SELECTOR_END) ||
    (scalar >= VARIATION_SELECTOR_SUPPLEMENT_START && scalar <= VARIATION_SELECTOR_SUPPLEMENT_END)
  );
}

function missingCmapScalars(text: string, cmap: FontkitFont): number[] {
  const missing: number[] = [];
  const seen = new Set<number>();
  for (const char of text) {
    const scalar = char.codePointAt(0)!;
    if (seen.has(scalar) || isInvisibleShapingControl(scalar)) continue;
    seen.add(scalar);
    if (!cmap.hasGlyphForCodePoint(scalar)) missing.push(scalar);
  }
  return missing;
}

function cmapCoverageReason(missing: readonly number[] | 'unreadable'): string {
  if (missing === 'unreadable') {
    return 'The selected embedded face has no inspectable cmap for Unicode coverage';
  }
  const shown = missing.slice(0, MAX_REPORTED_MISSING_SCALARS).map(formatUnicodeScalar);
  const extra = missing.length - shown.length;
  const list = shown.join(', ');
  const more = extra > 0 ? `, and ${extra} more` : '';
  const noun = missing.length === 1 ? 'scalar' : 'scalars';
  return `The selected embedded face is missing cmap coverage for Unicode ${noun} ${list}${more}`;
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
    admittedFamilyKey(font.request.family) ===
      admittedFamilyKey(style.fontFamily ?? defaultFontFamily ?? null) &&
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

interface UnderlinePaintBuffer {
  pending: PdfUnderlineSegment | null;
}

interface TextSpanPaintContext {
  readonly commands: readonly PdfPaintCommand[];
  commandIndex: number;
  readonly underline: UnderlinePaintBuffer;
  readonly underlineMetrics: Map<string, PdfUnderlineMetrics | null>;
  readonly singleUnderlineGridPt?: number;
}

function strikeLineWidth(fontSizePt: number): number {
  return Math.max(0.5, fontSizePt / 18);
}

function paintStrikeDecoration(
  doc: PDFKit.PDFDocument,
  command: Extract<PdfPaintCommand, { kind: 'textSpan' }>,
  y: number
): void {
  const { decoration, fontSizePt } = command.style;
  if (decoration !== 'strike' && decoration !== 'double-strike') return;
  const x = command.rect.x;
  const right = x + command.rect.width;
  if (!(right > x)) return;
  const lineWidth = strikeLineWidth(fontSizePt);
  const color = textColorOf(command.style);
  const stroke = (offset: number): void => {
    doc
      .lineWidth(lineWidth)
      .strokeColor(color)
      .moveTo(x, y + offset)
      .lineTo(right, y + offset)
      .stroke();
  };
  if (decoration === 'strike') {
    stroke(-fontSizePt * 0.3);
    return;
  }
  stroke(-fontSizePt * 0.22);
  stroke(-fontSizePt * 0.4);
}

function flushSingleUnderline(
  doc: PDFKit.PDFDocument,
  page: { height: number; open: boolean },
  underline: UnderlinePaintBuffer
): void {
  const pending = underline.pending;
  if (!pending || !page.open) {
    underline.pending = null;
    return;
  }
  if (!(pending.width > 0) || !(pending.thicknessPt > 0)) {
    underline.pending = null;
    return;
  }
  const rect = pdfRectToPdfKit(pdfUnderlineFillRect(pending), page.height);
  doc.fillColor(pending.color).rect(rect.x, rect.y, rect.width, rect.height).fill();
  underline.pending = null;
}

function underlineMetricsFor(
  font: PdfAdmittedFont | undefined,
  cache: Map<string, PdfUnderlineMetrics | null>
): PdfUnderlineMetrics {
  if (!font) return PDF_STANDARD_UNDERLINE_METRICS;
  const cached = cache.get(font.identity);
  if (cached !== undefined) return cached ?? PDF_STANDARD_UNDERLINE_METRICS;
  const metrics = pdfUnderlineMetricsFromSfnt(font.bytes, font.faceIndex);
  cache.set(font.identity, metrics);
  return metrics ?? PDF_STANDARD_UNDERLINE_METRICS;
}

function noteSingleUnderline(
  doc: PDFKit.PDFDocument,
  command: Extract<PdfPaintCommand, { kind: 'textSpan' }>,
  page: { height: number; index: number; open: boolean },
  context: TextSpanPaintContext,
  font: PdfAdmittedFont | undefined
): void {
  if (command.style.decoration !== 'underline') return;
  if (!(command.rect.width > 0)) return;
  const geometry = gridRoundedSingleUnderlineGeometry(
    pdfSingleUnderlineGeometry(
      command.style.fontSizePt,
      underlineMetricsFor(font, context.underlineMetrics)
    ),
    context.singleUnderlineGridPt
  );
  if (!(geometry.thicknessPt > 0)) return;
  const renderedWidth = doc.widthOfString(command.text);
  const excludedTrailingSpacePt =
    excludesTrailingUnderlineSpace(command) && renderedWidth > 0
      ? doc.widthOfString(' ') * (command.rect.width / renderedWidth)
      : 0;
  const segment: PdfUnderlineSegment = Object.freeze({
    pageIndex: page.index,
    x: command.rect.x,
    width: command.rect.width,
    baseline: command.baseline,
    color: textColorOf(command.style),
    thicknessPt: geometry.thicknessPt,
    offsetTopPt: geometry.offsetTopPt,
    linkKey: pdfUnderlineLinkKey(context.commands[context.commandIndex + 1]),
    gapAbsorptionPt: command.text.endsWith(' ') ? (command.underlineGapAbsorptionPt ?? 0) : 0,
    excludedTrailingSpacePt,
  });
  const pending = context.underline.pending;
  if (pending && canMergeSingleUnderlineRuns(pending, segment)) {
    context.underline.pending = extendSingleUnderlineRun(pending, segment);
    return;
  }
  flushSingleUnderline(doc, page, context.underline);
  context.underline.pending = segment;
}

function paintCommand(
  doc: PDFKit.PDFDocument,
  command: PdfPaintCommand,
  page: { height: number; index: number; open: boolean },
  diagnostics: { push(diagnostic: ReturnType<typeof pdfUnsupportedDiagnostic>): void },
  admittedFonts: readonly PdfAdmittedFont[],
  defaultFontFamily: string | undefined,
  registeredFonts: Map<string, FontEmbeddingDecision>,
  cmapCache: EmbeddedCmapCache,
  context: TextSpanPaintContext
): { height: number; index: number; open: boolean; pageCountDelta: number } {
  switch (command.kind) {
    case 'beginPage': {
      flushSingleUnderline(doc, page, context.underline);
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
      flushSingleUnderline(doc, page, context.underline);
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
      if (style.decoration !== 'underline') {
        flushSingleUnderline(doc, page, context.underline);
      }
      const embedded = resolveEmbeddedFont(style, admittedFonts, defaultFontFamily);
      const decision = embedded
        ? (registeredFonts.get(embedded.font.identity) ?? fontEmbeddingDecision(embedded.font))
        : null;
      if (embedded && decision && !registeredFonts.has(embedded.font.identity)) {
        registeredFonts.set(embedded.font.identity, decision);
      }
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
      const useEmbedded = embedded !== null && decision?.kind === 'embed';
      if (useEmbedded && embedded && decision.kind === 'embed') {
        const cmap = embeddedFaceCmap(embedded.font, decision.collectionSelector, cmapCache);
        const missing =
          cmap === 'unreadable' ? 'unreadable' : missingCmapScalars(command.text, cmap);
        if (missing === 'unreadable' || missing.length > 0) {
          diagnostics.push(
            pdfUnsupportedDiagnostic({
              feature: 'font-cmap-coverage',
              pageIndex: page.index,
              recordKind: 'textSpan',
              recordId: embedded.font.identity,
              reason: cmapCoverageReason(missing),
            })
          );
          return { ...page, pageCountDelta: 0 };
        }
      }
      const mapped = useEmbedded ? null : resolveStandardFont(style);
      if (!useEmbedded && !isWinAnsiRepresentable(command.text)) {
        diagnostics.push(
          pdfUnsupportedDiagnostic({
            feature: 'standard-font-encoding',
            pageIndex: page.index,
            recordKind: 'textSpan',
            recordId: mapped!.recordId,
            reason: `Text cannot be encoded with PDF built-in font ${mapped!.pdfkitName} (WinAnsiEncoding) for requested family "${mapped!.requested}"`,
          })
        );
        return { ...page, pageCountDelta: 0 };
      }
      // Command baseline already includes Core baseline shift; do not apply style.baselineShiftPt again.
      const y = baselineToPdfKitY(command.baseline, page.height);
      if (useEmbedded && embedded && decision.kind === 'embed') {
        if (!registeredFonts.has(embedded.key)) {
          if (decision.collectionSelector) {
            doc.registerFont(
              embedded.key,
              Buffer.from(embedded.font.bytes),
              decision.collectionSelector
            );
          } else {
            doc.registerFont(embedded.key, Buffer.from(embedded.font.bytes));
          }
          registeredFonts.set(embedded.key, decision);
        }
        doc.font(embedded.key);
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
      paintStrikeDecoration(doc, command, y);
      noteSingleUnderline(
        doc,
        command,
        page,
        context,
        useEmbedded && embedded ? embedded.font : undefined
      );
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
      flushSingleUnderline(doc, page, context.underline);
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
    const cmapCache: EmbeddedCmapCache = new Map();
    const underlineContext: TextSpanPaintContext = {
      commands: plan.commands,
      commandIndex: 0,
      underline: { pending: null },
      underlineMetrics: new Map(),
      ...(options.singleUnderlineGridPt
        ? { singleUnderlineGridPt: options.singleUnderlineGridPt }
        : {}),
    };

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
        underlineContext.commandIndex = index;
        const next = paintCommand(
          doc,
          plan.commands[index]!,
          page,
          diagnostics,
          options.admittedFonts ?? [],
          options.defaultFontFamily,
          registeredFonts,
          cmapCache,
          underlineContext
        );
        pageCount += next.pageCountDelta;
        page = { height: next.height, index: next.index, open: next.open };
      }
      flushSingleUnderline(doc, page, underlineContext.underline);

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

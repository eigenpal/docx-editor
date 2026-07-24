// Native PDF backend (document-engine task 8.11 core / design D7). Consumes the
// anchored DisplayItem[] IR from engine-layout and emits positioned glyphs with
// pdf-lib — no browser, no re-derived geometry. This is the "one IR, many
// backends" contract: the PDF backend reads the same display list the DOM and
// hit-test backends do. Fixed-point layout units (twips, 1/1440in) convert to PDF
// points (1/72in). Full PDF/UA-1 tagging is a follow-up behind this generator.

import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import type { LayoutResult } from '@docx-editor.dev/engine-layout';
import { assertNeverDisplayItem } from './output-capabilities.ts';

const TWIPS_PER_POINT = 20; // 1440 twips/in ÷ 72 pt/in

function toPt(twips: number): number {
  return twips / TWIPS_PER_POINT;
}

/** Render a layout result to native PDF bytes (positioned text, real pages). */
export async function renderPdf(layout: LayoutResult): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const boldItalic = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);

  const pickFont = (b: boolean, i: boolean): PDFFont =>
    b && i ? boldItalic : b ? bold : i ? italic : regular;

  for (const page of layout.pages) {
    const widthPt = toPt(page.width);
    const heightPt = toPt(page.height);
    const pdfPage = pdf.addPage([widthPt, heightPt]);
    for (const item of page.items) {
      switch (item.type) {
        case 'text': {
          const sizePt = toPt(item.height) * 0.9; // leading -> glyph size
          pdfPage.drawText(item.text, {
            x: toPt(item.x),
            // PDF y-origin is bottom-left; layout y is top-down.
            y: heightPt - toPt(item.y) - sizePt,
            size: sizePt,
            font: pickFont(item.bold, item.italic),
          });
          break;
        }
        case 'rect':
          // Table border/shading rects are not yet drawn by the PDF backend (a follow-up behind this
          // generator). Skip EXPLICITLY — the exhaustive default below still forces any NEW kind to
          // be handled here rather than silently dropped.
          break;
        default:
          assertNeverDisplayItem(item);
      }
    }
  }
  return pdf.save();
}

/** Reload PDF bytes for semantic inspection (page count, validity). */
export async function inspectPdf(bytes: Uint8Array): Promise<{ pageCount: number; valid: boolean }> {
  try {
    const pdf = await PDFDocument.load(bytes);
    return { pageCount: pdf.getPageCount(), valid: true };
  } catch {
    return { pageCount: 0, valid: false };
  }
}

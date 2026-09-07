/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { PageRecord, ParagraphFragmentRecord } from '@docx-editor.dev/core/layout';
import { baselineShiftPtOf, styleForFontSlot } from '@docx-editor.dev/core/layout';
import {
  compatibleWordMacos300DpiTextStyle,
  quantizeWordMacos300DpiRect,
  type PdfCompatibilityProfile,
} from './pdf-compatibility-profile.ts';
import { coreBoxToPdfRect } from './pdf-coordinates.ts';
import type { PdfFidelityStoryKind } from './pdf-fidelity-diagnostics.ts';
import { pdfTextSpan, type PdfTextSpanCommand } from './pdf-paint-types.ts';
import { compatibleSpanBaseline } from './pdf-span-geometry.ts';
import { pdfDisplayText, pdfTextStyleFromResolvedRunStyle } from './pdf-text-style.ts';

function markerLineBaseline(
  fragment: ParagraphFragmentRecord,
  fontSizePt: number
): Readonly<{ readonly lineY: number; readonly baseline: number }> {
  const firstLine = fragment.lines[0];
  if (firstLine) return Object.freeze({ lineY: firstLine.box.y, baseline: firstLine.baseline });
  const markerBox = fragment.marker?.box;
  const boxHeight = markerBox && markerBox.height > 0 ? markerBox.height : fontSizePt;
  const fallback = fontSizePt > 0 ? Math.min(fontSizePt, boxHeight) : boxHeight;
  return Object.freeze({
    lineY: markerBox?.y ?? 0,
    baseline: fallback > 0 ? fallback : 0,
  });
}

export function plannedParagraphMarkerCommand(input: {
  readonly page: PageRecord;
  readonly storyKind: PdfFidelityStoryKind;
  readonly storyOrigin: Readonly<{ readonly x: number; readonly y: number }>;
  readonly fragment: ParagraphFragmentRecord;
  readonly profile: PdfCompatibilityProfile | undefined;
}): PdfTextSpanCommand | null {
  const { page, storyKind, storyOrigin, fragment, profile } = input;
  const marker = fragment.marker;
  if (!marker || marker.text.length === 0) return null;
  const coreRect = Object.freeze({
    x: storyOrigin.x + marker.box.x - page.box.x,
    y: storyOrigin.y + marker.box.y - page.box.y,
    width: marker.box.width,
    height: marker.box.height,
  });
  const faceStyle = styleForFontSlot(marker.style, undefined);
  const lineBaseline = markerLineBaseline(fragment, faceStyle.fontSizePt);
  return pdfTextSpan(
    profile === 'word-macos-300dpi'
      ? quantizeWordMacos300DpiRect(coreBoxToPdfRect(coreRect, page.box.height))
      : coreBoxToPdfRect(coreRect, page.box.height),
    compatibleSpanBaseline(
      page,
      storyOrigin.y,
      lineBaseline.lineY,
      lineBaseline.baseline,
      baselineShiftPtOf(faceStyle),
      storyKind === 'footer',
      profile
    ),
    pdfDisplayText(marker.text, marker.style),
    compatibleWordMacos300DpiTextStyle(pdfTextStyleFromResolvedRunStyle(marker.style), profile)
  );
}

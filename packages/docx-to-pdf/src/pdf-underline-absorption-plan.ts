/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { LineRecord, PageRecord, StyleSpanRecord } from '@docx-editor.dev/core/layout';
import { coreBoxToPdfRect } from './pdf-coordinates.ts';
import {
  quantizeWordMacos300DpiLineRect,
  type PdfCompatibilityProfile,
} from './pdf-compatibility-profile.ts';
import type { PdfRect } from './pdf-paint-types.ts';
import { pdfUnderlineJustifyGapAbsorptionPt } from './pdf-underline-geometry.ts';

const NON_PAINTING_CONTROL_CHARS = new Set(['\f', '\n', '\r', '\t']);

function pageRelativeBox(
  page: PageRecord,
  absolute: Readonly<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>
): PdfRect {
  return coreBoxToPdfRect(
    Object.freeze({
      x: absolute.x - page.box.x,
      y: absolute.y - page.box.y,
      width: absolute.width,
      height: absolute.height,
    }),
    page.box.height
  );
}

function spanLinePdfRect(
  page: PageRecord,
  storyOrigin: Readonly<{ readonly x: number; readonly y: number }>,
  lineX: number,
  spanBox: StyleSpanRecord['box'],
  profile: PdfCompatibilityProfile | undefined
): PdfRect {
  const base = pageRelativeBox(page, {
    x: storyOrigin.x + spanBox.x,
    y: storyOrigin.y + spanBox.y,
    width: spanBox.width,
    height: spanBox.height,
  });
  return profile === 'word-macos-300dpi'
    ? quantizeWordMacos300DpiLineRect(base, storyOrigin.x - page.box.x + lineX)
    : base;
}

function isControlTabSpan(span: StyleSpanRecord): boolean {
  if (span.text.length === 0) return false;
  for (const codeUnit of span.text) {
    if (!NON_PAINTING_CONTROL_CHARS.has(codeUnit)) return false;
  }
  return true;
}

function spansShareAnchor(left: StyleSpanRecord, right: StyleSpanRecord): boolean {
  if (!left.link && !right.link) return true;
  if (!left.link || !right.link || left.link.id !== right.link.id) return false;
  if (Boolean(left.fieldAtom) !== Boolean(right.fieldAtom)) return false;
  return !left.fieldAtom || left.range.start === right.range.start;
}

function drawingOccupiesGap(
  line: LineRecord,
  previous: StyleSpanRecord,
  current: StyleSpanRecord,
  paragraphRank: (paragraphId: string) => number
): boolean {
  const drawings = line.drawings;
  if (!drawings || drawings.length === 0) return false;
  const previousRank = paragraphRank(previous.range.paragraphId);
  const currentRank = paragraphRank(current.range.paragraphId);
  for (let index = 0; index < drawings.length; index += 1) {
    const drawing = drawings[index]!;
    const rank = paragraphRank(drawing.paragraphId);
    const afterPrevious =
      rank > previousRank || (rank === previousRank && drawing.start >= previous.range.start);
    const beforeCurrent =
      rank < currentRank || (rank === currentRank && drawing.start < current.range.start);
    if (afterPrevious && beforeCurrent) return true;
  }
  return false;
}

/**
 * Layout-evidence absorption for the span that is about to be painted.
 * The gap is the transformed distance between this span and the next line sibling.
 */
export function plannedUnderlineGapAbsorptionPt(input: {
  readonly page: PageRecord;
  readonly storyOrigin: Readonly<{ readonly x: number; readonly y: number }>;
  readonly lineX: number;
  readonly line: LineRecord;
  readonly span: StyleSpanRecord;
  readonly leftRect: PdfRect;
  readonly profile: PdfCompatibilityProfile | undefined;
  readonly paragraphOrder: ReadonlyMap<string, number>;
}): number | undefined {
  const spanIndex = input.line.spans.indexOf(input.span);
  if (spanIndex < 0 || spanIndex >= input.line.spans.length - 1) return undefined;
  const next = input.line.spans[spanIndex + 1]!;
  if (next.style.hidden || next.equation) return undefined;
  if (!input.span.style.underline || !next.style.underline) return undefined;
  if (next.box.width <= 0 || next.box.height <= 0) return undefined;
  const rightRect = spanLinePdfRect(
    input.page,
    input.storyOrigin,
    input.lineX,
    next.box,
    input.profile
  );
  const absorption = pdfUnderlineJustifyGapAbsorptionPt({
    precedingText: input.span.text,
    gapAfterPt: rightRect.x - (input.leftRect.x + input.leftRect.width),
    nextWrapAdvanceBeforePt: next.wrapAdvanceBefore,
    nextIsTab: isControlTabSpan(next),
    sharesAnchor: spansShareAnchor(input.span, next),
    horizontalScalePercent: input.span.style.horizontalScalePercent,
    drawingOccupiesGap: drawingOccupiesGap(
      input.line,
      input.span,
      next,
      (paragraphId) => input.paragraphOrder.get(paragraphId) ?? Number.MAX_SAFE_INTEGER
    ),
    leftUnderlined: Boolean(input.span.style.underline),
    rightUnderlined: Boolean(next.style.underline),
  });
  return absorption > 0 ? absorption : undefined;
}

/** True when the final U+0020 hangs past its line and must not extend the merged rule. */
export function plannedUnderlineExcludesTrailingSpace(
  line: LineRecord,
  span: StyleSpanRecord,
  profile: PdfCompatibilityProfile | undefined
): boolean {
  if (profile !== 'word-macos-300dpi' || !span.text.endsWith(' ')) return false;
  const spanIndex = line.spans.indexOf(span);
  return (
    spanIndex === line.spans.length - 1 && span.box.x + span.box.width > line.box.x + line.box.width
  );
}

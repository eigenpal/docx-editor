/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { PageRecord } from '@docx-editor.dev/core/layout';
import {
  quantizeWordMacos300DpiStoryBaseline,
  type PdfCompatibilityProfile,
} from './pdf-compatibility-profile.ts';
import { coreYToPdfY } from './pdf-coordinates.ts';

/** Apply the body/header nearest phase or the footer trailing-edge phase. */
export function compatibleSpanBaseline(
  page: PageRecord,
  storyOriginY: number,
  lineY: number,
  lineBaseline: number,
  baselineShiftPt: number,
  isFooter: boolean,
  profile: PdfCompatibilityProfile | undefined
): number {
  const continuous = coreYToPdfY(
    storyOriginY - page.box.y + lineY + lineBaseline - baselineShiftPt,
    page.box.height
  );
  return profile === 'word-macos-300dpi'
    ? quantizeWordMacos300DpiStoryBaseline(continuous, isFooter)
    : continuous;
}

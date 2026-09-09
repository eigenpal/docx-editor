/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { SemanticFillHostVisit } from '@docx-editor.dev/core/layout';
import {
  pdfFillRect,
  pdfStrokeRect,
  type PdfPaintCommand,
  type PdfRect,
} from './pdf-paint-types.ts';

export function pdfTextboxFrameCommands(
  host: SemanticFillHostVisit,
  toPageRect: (
    absolute: Readonly<{ x: number; y: number; width: number; height: number }>
  ) => PdfRect
): readonly PdfPaintCommand[] {
  const owner = host.textboxOwner;
  const story = owner?.textboxStory;
  if (!owner || !story) return [];
  if (
    !Number.isFinite(owner.width) ||
    owner.width <= 0 ||
    !Number.isFinite(owner.height) ||
    owner.height <= 0
  )
    return [];
  const transform = owner.transform;
  if (
    transform &&
    (transform.rotationDegrees !== 0 || transform.flipHorizontal || transform.flipVertical)
  )
    return [];
  const rect = toPageRect({
    x: host.storyOrigin.x - story.contentOffset.x,
    y: host.storyOrigin.y - story.contentOffset.y,
    width: owner.width,
    height: owner.height,
  });
  const commands: PdfPaintCommand[] = [];
  if (story.fillHex) {
    commands.push(pdfFillRect(rect, `#${story.fillHex}`));
  }
  if (story.strokeHex && story.strokeWidthPt > 0) {
    commands.push(pdfStrokeRect(rect, `#${story.strokeHex}`, story.strokeWidthPt));
  }
  return commands;
}

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type {
  BlockFragmentRecord,
  PageRecord,
  ParagraphBorderStrokeRecord,
  ParagraphFragmentRecord,
} from '@docx-editor.dev/core/layout';
import { pdfColorFromPublishedFill } from './pdf-fill-contrast.ts';
import type { PdfFidelityDiagnostic, PdfFidelityStoryKind } from './pdf-fidelity-diagnostics.ts';
import { pdfApproximationDiagnostic } from './pdf-fidelity-diagnostics.ts';
import type { PdfRect } from './pdf-paint-types.ts';
import { pdfFillRect, type PdfPaintCommand } from './pdf-paint-types.ts';

const BLACK = '#000000';

function hasUsableBox(box: Readonly<{ readonly width: number; readonly height: number }>): boolean {
  return box.width > 0 && box.height > 0;
}

function isExactSolidParagraphBorder(val: string): boolean {
  return val === 'single' || val === 'thick';
}

function paragraphBorderColor(color: string | null): string {
  if (!color || color === 'auto') return BLACK;
  return pdfColorFromPublishedFill(color) ?? BLACK;
}

function publishedParagraphBorderStrokes(
  block: ParagraphFragmentRecord
): readonly ParagraphBorderStrokeRecord[] {
  if (block.borders && block.borders.length > 0) return block.borders;
  if (!block.bottomBorder) return [];
  return [
    {
      side: 'bottom',
      edge: block.bottomBorder.edge,
      box: block.bottomBorder.box,
    },
  ];
}

function paintPublishedBorderStroke(
  page: PageRecord,
  storyOrigin: Readonly<{ readonly x: number; readonly y: number }>,
  block: ParagraphFragmentRecord,
  stroke: ParagraphBorderStrokeRecord,
  story: PdfFidelityStoryKind | null,
  toPageRect: (
    absolute: Readonly<{
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }>
  ) => PdfRect,
  pushCommand: (command: PdfPaintCommand) => void,
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void }
): void {
  if (!hasUsableBox(stroke.box)) return;
  pushCommand(
    pdfFillRect(
      toPageRect({
        x: storyOrigin.x + stroke.box.x,
        y: storyOrigin.y + stroke.box.y,
        width: stroke.box.width,
        height: stroke.box.height,
      }),
      paragraphBorderColor(stroke.edge.color)
    )
  );
  if (isExactSolidParagraphBorder(stroke.edge.val)) return;
  diagnostics.push(
    pdfApproximationDiagnostic({
      feature: 'paragraph-border',
      pageIndex: page.index,
      recordKind: 'paragraphFragment',
      recordId: block.id,
      story,
      reason:
        `Paragraph border val "${stroke.edge.val}" (${stroke.side}) is painted as a solid` +
        ' rule at the published edge box',
    })
  );
}

export function* visitBlocksForPublishedBorders(
  page: PageRecord,
  storyOrigin: Readonly<{ readonly x: number; readonly y: number }>,
  blocks: readonly BlockFragmentRecord[],
  story: PdfFidelityStoryKind | null,
  toPageRect: (
    absolute: Readonly<{
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }>
  ) => PdfRect,
  pushCommand: (command: PdfPaintCommand) => void,
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void }
): Generator<void> {
  for (const block of blocks) {
    if (block.kind === 'table') {
      yield;
      for (const row of block.rows) {
        if (row.cells.length === 0) {
          yield;
          continue;
        }
        for (const cell of row.cells) {
          yield;
          yield* visitBlocksForPublishedBorders(
            page,
            storyOrigin,
            cell.blocks,
            story,
            toPageRect,
            pushCommand,
            diagnostics
          );
        }
      }
      continue;
    }
    const strokes = publishedParagraphBorderStrokes(block);
    if (strokes.length === 0) {
      yield;
      continue;
    }
    for (const stroke of strokes) {
      paintPublishedBorderStroke(
        page,
        storyOrigin,
        block,
        stroke,
        story,
        toPageRect,
        pushCommand,
        diagnostics
      );
      yield;
    }
  }
}

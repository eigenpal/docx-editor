/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { BlockFragmentRecord, PageRecord } from '@docx-editor.dev/core/layout';
import { validateColor } from './pdf-paint-bounds.ts';
import type { PdfFidelityDiagnostic, PdfFidelityStoryKind } from './pdf-fidelity-diagnostics.ts';
import { pdfUnsupportedDiagnostic } from './pdf-fidelity-diagnostics.ts';
import type { PdfRect } from './pdf-paint-types.ts';
import { pdfFillRect, type PdfPaintCommand } from './pdf-paint-types.ts';

const HEX_FILL = /^[0-9A-Fa-f]{6}$/;
const WHITE = '#FFFFFF';
const BLACK = '#000000';
const MIN_CONTRAST = 4.5;

export interface PdfFillBacking {
  readonly paragraphFill: Map<string, string>;
  readonly cellFill: Map<string, string>;
}

export function createPdfFillBacking(): PdfFillBacking {
  return { paragraphFill: new Map(), cellFill: new Map() };
}

export function pdfColorFromPublishedFill(fill: string): string | null {
  if (!HEX_FILL.test(fill)) return null;
  return validateColor(`#${fill}`);
}

function channelToLinear(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: string): number {
  const hex = color.slice(1);
  const red = channelToLinear(Number.parseInt(hex.slice(0, 2), 16));
  const green = channelToLinear(Number.parseInt(hex.slice(2, 4), 16));
  const blue = channelToLinear(Number.parseInt(hex.slice(4, 6), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function pdfContrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function pdfTextForeground(color: string | null): string {
  return color ?? BLACK;
}

export function paintedFillForParagraph(backing: PdfFillBacking, paragraphId: string): string {
  return backing.paragraphFill.get(paragraphId) ?? backing.cellFill.get(paragraphId) ?? WHITE;
}

function hasUsableBox(box: Readonly<{ readonly width: number; readonly height: number }>): boolean {
  return box.width > 0 && box.height > 0;
}

export function unreadableWithoutFillDiagnostic(input: {
  readonly pageIndex: number;
  readonly paragraphId: string;
  readonly story: PdfFidelityStoryKind | null;
  readonly foreground: string;
  readonly paintedBackground: string;
  readonly omittedFill: string | null;
}): PdfFidelityDiagnostic | null {
  const contrast = pdfContrastRatio(input.foreground, input.paintedBackground);
  if (contrast >= MIN_CONTRAST) return null;
  const omitted = input.omittedFill ? ` omitted fill ${input.omittedFill}` : ' no published fill';
  return pdfUnsupportedDiagnostic({
    feature: 'unreadable-without-fill',
    pageIndex: input.pageIndex,
    recordKind: 'styleSpan',
    recordId: input.paragraphId,
    story: input.story,
    reason:
      `Text colour ${input.foreground} has contrast ${contrast.toFixed(2)}:1 against painted` +
      ` background ${input.paintedBackground};${omitted} leaves the glyphs unreadable`,
  });
}

export function* visitBlocksForPublishedFills(
  page: PageRecord,
  storyOrigin: Readonly<{ readonly x: number; readonly y: number }>,
  blocks: readonly BlockFragmentRecord[],
  story: PdfFidelityStoryKind | null,
  backing: PdfFillBacking,
  toPageRect: (
    absolute: Readonly<{
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }>
  ) => PdfRect,
  pushCommand: (command: PdfPaintCommand) => void,
  diagnostics: { push(diagnostic: PdfFidelityDiagnostic): void },
  inheritedCellFill: string | null = null
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
          const cellFill =
            !cell.paintInert && !cell.vMergeContinue && cell.shading
              ? pdfColorFromPublishedFill(cell.shading)
              : null;
          const paintedCellFill = cellFill && hasUsableBox(cell.box) ? cellFill : null;
          if (paintedCellFill) {
            pushCommand(
              pdfFillRect(
                toPageRect({
                  x: storyOrigin.x + cell.box.x,
                  y: storyOrigin.y + cell.box.y,
                  width: cell.box.width,
                  height: cell.box.height,
                }),
                paintedCellFill
              )
            );
          }
          yield;
          yield* visitBlocksForPublishedFills(
            page,
            storyOrigin,
            cell.blocks,
            story,
            backing,
            toPageRect,
            pushCommand,
            diagnostics,
            paintedCellFill ?? inheritedCellFill
          );
        }
      }
      continue;
    }
    if (inheritedCellFill) backing.cellFill.set(block.paragraphId, inheritedCellFill);
    if (block.shading && block.shadingBox && hasUsableBox(block.shadingBox)) {
      const fill = pdfColorFromPublishedFill(block.shading);
      if (fill) {
        pushCommand(
          pdfFillRect(
            toPageRect({
              x: storyOrigin.x + block.shadingBox.x,
              y: storyOrigin.y + block.shadingBox.y,
              width: block.shadingBox.width,
              height: block.shadingBox.height,
            }),
            fill
          )
        );
        backing.paragraphFill.set(block.paragraphId, fill);
      }
    } else if (block.shading) {
      diagnostics.push(
        pdfUnsupportedDiagnostic({
          feature: 'paragraph-shading',
          pageIndex: page.index,
          recordKind: 'paragraphFragment',
          recordId: block.id,
          story,
          reason:
            'Paragraph shading has no usable shadingBox, so the fill is not encoded in the PDF paint slice',
        })
      );
    }
    yield;
  }
}

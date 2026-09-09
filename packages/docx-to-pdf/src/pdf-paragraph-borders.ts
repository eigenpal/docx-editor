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
  ResolvedTableBorderEdge,
  TableBorderStrokeRecord,
  TableCellFragmentRecord,
  TableBorderSideName,
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

function paintPublishedTableBorderStroke(
  page: PageRecord,
  storyOrigin: Readonly<{ readonly x: number; readonly y: number }>,
  cell: TableCellFragmentRecord,
  stroke: TableBorderStrokeRecord,
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
  if (stroke.width <= 0 || stroke.height <= 0) return;
  pushCommand(
    pdfFillRect(
      toPageRect({
        x: storyOrigin.x + cell.box.x + stroke.x,
        y: storyOrigin.y + cell.box.y + stroke.y,
        width: stroke.width,
        height: stroke.height,
      }),
      paragraphBorderColor(stroke.color)
    )
  );
  if (stroke.cssStyle === 'solid') return;
  diagnostics.push(
    pdfApproximationDiagnostic({
      feature: 'table-border',
      pageIndex: page.index,
      recordKind: 'tableCellFragment',
      recordId: cell.id,
      story,
      reason:
        `Table border ${stroke.cssStyle} (${stroke.side}) is painted as a solid rule at the` +
        ' published stroke box',
    })
  );
}

function simpleStroke(
  cell: TableCellFragmentRecord,
  side: TableBorderSideName,
  edge: ResolvedTableBorderEdge,
  startPt: number,
  endPt: number
): TableBorderStrokeRecord {
  const horizontal = side === 'top' || side === 'bottom';
  const length = Math.max(0, endPt - startPt);
  return {
    side,
    role: 'edge',
    color: edge.color,
    cssStyle: edge.style === 'dashed' || edge.style === 'dotted' ? edge.style : 'solid',
    x: side === 'right' ? Math.max(0, cell.box.width - edge.widthPt) : horizontal ? startPt : 0,
    y: side === 'bottom' ? Math.max(0, cell.box.height - edge.widthPt) : horizontal ? 0 : startPt,
    width: horizontal ? length : edge.widthPt,
    height: horizontal ? edge.widthPt : length,
  };
}

function publishedSimpleTableStrokes(
  cell: TableCellFragmentRecord
): readonly TableBorderStrokeRecord[] {
  if (!cell.borders) return [];
  const compoundSides = new Set((cell.borders.strokes ?? []).map((stroke) => stroke.side));
  const strokes: TableBorderStrokeRecord[] = [];
  const segmentedSides = new Set<TableBorderSideName>();
  for (const segment of cell.borders.edgeSegments ?? []) {
    if (compoundSides.has(segment.side)) continue;
    segmentedSides.add(segment.side);
    strokes.push(simpleStroke(cell, segment.side, segment.edge, segment.startPt, segment.endPt));
  }
  for (const side of ['top', 'left', 'bottom', 'right'] as const) {
    if (compoundSides.has(side) || segmentedSides.has(side)) continue;
    const edge = cell.borders[side];
    if (!edge) continue;
    const end = side === 'top' || side === 'bottom' ? cell.box.width : cell.box.height;
    strokes.push(simpleStroke(cell, side, edge, 0, end));
  }
  return strokes;
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
          if (!cell.paintInert && !cell.vMergeContinue) {
            const strokes = [
              ...(cell.borders?.strokes ?? []),
              ...publishedSimpleTableStrokes(cell),
            ];
            for (const stroke of strokes) {
              paintPublishedTableBorderStroke(
                page,
                storyOrigin,
                cell,
                stroke,
                story,
                toPageRect,
                pushCommand,
                diagnostics
              );
              yield;
            }
          }
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

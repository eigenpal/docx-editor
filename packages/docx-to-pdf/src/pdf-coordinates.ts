import type { LayoutBox } from '@docx-editor.dev/core/layout';
import {
  validateCoordinate,
  validatePageDimension,
  validatePageIndex,
} from './pdf-paint-bounds.ts';
import type { PdfPoint, PdfRect } from './pdf-paint-types.ts';

/** Core layout box in top-left page coordinates. @public */
export interface CoreLayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Page transform from Core top-left coordinates to PDF bottom-left coordinates. @public */
export interface PdfPageTransform {
  readonly pageIndex: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
}

function validateCoreBox(field: string, box: CoreLayoutBox): CoreLayoutBox {
  return Object.freeze({
    x: validateCoordinate(`${field}.x`, box.x),
    y: validateCoordinate(`${field}.y`, box.y),
    width: validatePageDimension(`${field}.width`, box.width),
    height: validatePageDimension(`${field}.height`, box.height),
  });
}

/** Creates an immutable page transform for one physical sheet. @public */
export function createPdfPageTransform(
  pageIndex: number,
  pageWidth: number,
  pageHeight: number
): PdfPageTransform {
  return Object.freeze({
    pageIndex: validatePageIndex(pageIndex),
    pageWidth: validatePageDimension('pageWidth', pageWidth),
    pageHeight: validatePageDimension('pageHeight', pageHeight),
  });
}

/** Converts a Core Y coordinate to PDF Y using the page height. @public */
export function coreYToPdfY(coreY: number, pageHeight: number): number {
  const boundedHeight = validatePageDimension('pageHeight', pageHeight);
  const boundedY = validateCoordinate('coreY', coreY);
  return boundedHeight - boundedY;
}

/** Converts a Core layout box to a PDF rectangle without rounding. @public */
export function coreBoxToPdfRect(box: CoreLayoutBox, pageHeight: number): PdfRect {
  const boundedBox = validateCoreBox('box', box);
  const boundedHeight = validatePageDimension('pageHeight', pageHeight);
  return Object.freeze({
    x: boundedBox.x,
    y: boundedHeight - boundedBox.y - boundedBox.height,
    width: boundedBox.width,
    height: boundedBox.height,
  });
}

/** Converts a Core layout point to a PDF point without rounding. @public */
export function corePointToPdfPoint(
  point: Readonly<{ readonly x: number; readonly y: number }>,
  pageHeight: number
): PdfPoint {
  return Object.freeze({
    x: validateCoordinate('point.x', point.x),
    y: coreYToPdfY(point.y, pageHeight),
  });
}

/** Adapts a Core {@link LayoutBox} to the paint-command box shape. @public */
export function layoutBoxToCoreLayoutBox(box: LayoutBox): CoreLayoutBox {
  return validateCoreBox('layoutBox', box);
}

/** Creates a page transform from a Core page record box. @public */
export function pdfPageTransformFromLayoutPage(
  pageIndex: number,
  pageBox: LayoutBox
): PdfPageTransform {
  const bounded = validateCoreBox('pageBox', pageBox);
  return createPdfPageTransform(pageIndex, bounded.width, bounded.height);
}

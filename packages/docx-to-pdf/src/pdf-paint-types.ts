/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  HARD_MAX_DESTINATION_NAME_LENGTH,
  HARD_MAX_LINK_TARGET_LENGTH,
  HARD_MAX_METADATA_VALUE_LENGTH,
  HARD_MAX_TEXT_SPAN_LENGTH,
  validateBoundedString,
  validateColor,
  validateCommandCount,
  validateCoordinate,
  validateLineWidth,
  validatePageCount,
  validatePageDimension,
  validatePageIndex,
} from './pdf-paint-bounds.ts';
import type { PdfTextStyle } from './pdf-text-style.ts';

/** Immutable point in PDF page coordinates (origin at lower-left). @public */
export interface PdfPoint {
  readonly x: number;
  readonly y: number;
}

/** Immutable axis-aligned rectangle in PDF page coordinates. @public */
export interface PdfRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** External hyperlink target accepted by the paint-command model. @public */
export interface PdfExternalLinkTarget {
  readonly kind: 'external';
  readonly href: string;
}

/** Internal document destination accepted by the paint-command model. @public */
export interface PdfInternalLinkTarget {
  readonly kind: 'internal';
  readonly destination: string;
}

/** Link annotation target. @public */
export type PdfLinkTarget = PdfExternalLinkTarget | PdfInternalLinkTarget;

/** Immutable paint-command vocabulary for one PDF page stream. @public */
export type PdfPaintCommand =
  | PdfBeginPageCommand
  | PdfSaveStateCommand
  | PdfRestoreStateCommand
  | PdfClipRectCommand
  | PdfFillRectCommand
  | PdfStrokeRectCommand
  | PdfTextSpanCommand
  | PdfImageCommand
  | PdfLinkCommand
  | PdfDestinationCommand;

/** Starts a new physical page. @public */
export interface PdfBeginPageCommand {
  readonly kind: 'beginPage';
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
}

/** Saves the current graphics state. @public */
export interface PdfSaveStateCommand {
  readonly kind: 'saveState';
}

/** Restores the previous graphics state. @public */
export interface PdfRestoreStateCommand {
  readonly kind: 'restoreState';
}

/** Clips subsequent painting to a rectangle. @public */
export interface PdfClipRectCommand {
  readonly kind: 'clipRect';
  readonly rect: PdfRect;
}

/** Fills an axis-aligned rectangle. @public */
export interface PdfFillRectCommand {
  readonly kind: 'fillRect';
  readonly rect: PdfRect;
  readonly color: string;
}

/** Strokes an axis-aligned rectangle. @public */
export interface PdfStrokeRectCommand {
  readonly kind: 'strokeRect';
  readonly rect: PdfRect;
  readonly color: string;
  readonly lineWidth: number;
}

/** Paints extractable Unicode text at a semantic baseline. @public */
export interface PdfTextSpanCommand {
  readonly kind: 'textSpan';
  readonly rect: PdfRect;
  readonly baseline: number;
  readonly text: string;
  readonly style: PdfTextStyle;
}

/** Embeds a validated raster image at semantic geometry. @public */
export interface PdfImageCommand {
  readonly kind: 'image';
  readonly rect: PdfRect;
  readonly imageId: string;
  readonly opacity: number;
}

/** Emits a link annotation over semantic geometry. @public */
export interface PdfLinkCommand {
  readonly kind: 'link';
  readonly rect: PdfRect;
  readonly target: PdfLinkTarget;
}

/** Registers a named internal destination. @public */
export interface PdfDestinationCommand {
  readonly kind: 'destination';
  readonly name: string;
  readonly rect: PdfRect;
}

/** Bounded document metadata mapped into the PDF Info dictionary. @public */
export interface PdfDocumentMetadata {
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  readonly keywords?: string;
}

/** Ordered immutable paint plan for one PDF export. @public */
export interface PdfPaintPlan {
  readonly commands: readonly PdfPaintCommand[];
  readonly documentMetadata: PdfDocumentMetadata;
}

const EMPTY_PDF_DOCUMENT_METADATA: PdfDocumentMetadata = Object.freeze({});

function copyOptionalMetadataField(
  target: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
  },
  key: keyof PdfDocumentMetadata,
  value: string | undefined
): void {
  if (value === undefined) return;
  const bounded = validateBoundedString(key, value, HARD_MAX_METADATA_VALUE_LENGTH);
  if (bounded.length === 0) return;
  target[key] = bounded;
}

function freezePdfDocumentMetadata(metadata: PdfDocumentMetadata): PdfDocumentMetadata {
  const frozen: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
  } = {};
  copyOptionalMetadataField(frozen, 'title', metadata.title);
  copyOptionalMetadataField(frozen, 'author', metadata.author);
  copyOptionalMetadataField(frozen, 'subject', metadata.subject);
  copyOptionalMetadataField(frozen, 'keywords', metadata.keywords);
  if (
    frozen.title === undefined &&
    frozen.author === undefined &&
    frozen.subject === undefined &&
    frozen.keywords === undefined
  ) {
    return EMPTY_PDF_DOCUMENT_METADATA;
  }
  return Object.freeze(frozen);
}

/** Appends paint commands with a bounded loop instead of call-stack varargs. @public */
export function appendPaintCommands(
  target: PdfPaintCommand[],
  source: readonly PdfPaintCommand[]
): void {
  for (let index = 0; index < source.length; index += 1) {
    target.push(source[index]!);
  }
}

function freezeRect(rect: PdfRect): PdfRect {
  return Object.freeze({
    x: validateCoordinate('rect.x', rect.x),
    y: validateCoordinate('rect.y', rect.y),
    width: validatePageDimension('rect.width', rect.width),
    height: validatePageDimension('rect.height', rect.height),
  });
}

/** Creates a validated begin-page command. @public */
export function pdfBeginPage(
  pageIndex: number,
  width: number,
  height: number
): PdfBeginPageCommand {
  return Object.freeze({
    kind: 'beginPage',
    pageIndex: validatePageIndex(pageIndex),
    width: validatePageDimension('width', width),
    height: validatePageDimension('height', height),
  });
}

/** Creates a validated save-state command. @public */
export function pdfSaveState(): PdfSaveStateCommand {
  return Object.freeze({ kind: 'saveState' });
}

/** Creates a validated restore-state command. @public */
export function pdfRestoreState(): PdfRestoreStateCommand {
  return Object.freeze({ kind: 'restoreState' });
}

/** Creates a validated clip-rect command. @public */
export function pdfClipRect(rect: PdfRect): PdfClipRectCommand {
  return Object.freeze({
    kind: 'clipRect',
    rect: freezeRect(rect),
  });
}

/** Creates a validated fill-rect command. @public */
export function pdfFillRect(rect: PdfRect, color: string): PdfFillRectCommand {
  return Object.freeze({
    kind: 'fillRect',
    rect: freezeRect(rect),
    color: validateColor(color),
  });
}

/** Creates a validated stroke-rect command. @public */
export function pdfStrokeRect(
  rect: PdfRect,
  color: string,
  lineWidth: number
): PdfStrokeRectCommand {
  return Object.freeze({
    kind: 'strokeRect',
    rect: freezeRect(rect),
    color: validateColor(color),
    lineWidth: validateLineWidth(lineWidth),
  });
}

/** Creates a validated text-span command. @public */
export function pdfTextSpan(
  rect: PdfRect,
  baseline: number,
  text: string,
  style: PdfTextStyle
): PdfTextSpanCommand {
  return Object.freeze({
    kind: 'textSpan',
    rect: freezeRect(rect),
    baseline: validateCoordinate('baseline', baseline),
    text: validateBoundedString('text', text, HARD_MAX_TEXT_SPAN_LENGTH),
    style,
  });
}

/** Creates a validated image command. @public */
export function pdfImage(rect: PdfRect, imageId: string, opacity: number = 1): PdfImageCommand {
  return Object.freeze({
    kind: 'image',
    rect: freezeRect(rect),
    imageId: validateBoundedString('imageId', imageId, 256),
    opacity: validateCoordinate('opacity', opacity),
  });
}

/** Creates a validated external link command. @public */
export function pdfExternalLink(rect: PdfRect, href: string): PdfLinkCommand {
  return Object.freeze({
    kind: 'link',
    rect: freezeRect(rect),
    target: Object.freeze({
      kind: 'external',
      href: validateBoundedString('href', href, HARD_MAX_LINK_TARGET_LENGTH),
    }),
  });
}

/** Creates a validated internal link command. @public */
export function pdfInternalLink(rect: PdfRect, destination: string): PdfLinkCommand {
  return Object.freeze({
    kind: 'link',
    rect: freezeRect(rect),
    target: Object.freeze({
      kind: 'internal',
      destination: validateBoundedString(
        'destination',
        destination,
        HARD_MAX_DESTINATION_NAME_LENGTH
      ),
    }),
  });
}

/** Creates a validated named destination command. @public */
export function pdfDestination(name: string, rect: PdfRect): PdfDestinationCommand {
  return Object.freeze({
    kind: 'destination',
    name: validateBoundedString('name', name, HARD_MAX_DESTINATION_NAME_LENGTH),
    rect: freezeRect(rect),
  });
}

/** Creates an immutable validated paint plan. @public */
export function createPdfPaintPlan(
  commands: readonly PdfPaintCommand[],
  documentMetadata: PdfDocumentMetadata = EMPTY_PDF_DOCUMENT_METADATA
): PdfPaintPlan {
  validateCommandCount(commands.length);
  let pageCount = 0;
  for (const command of commands) {
    if (command.kind === 'beginPage') pageCount += 1;
  }
  validatePageCount(pageCount);
  const copied: PdfPaintCommand[] = [];
  appendPaintCommands(copied, commands);
  return Object.freeze({
    commands: Object.freeze(copied),
    documentMetadata: freezePdfDocumentMetadata(documentMetadata),
  });
}

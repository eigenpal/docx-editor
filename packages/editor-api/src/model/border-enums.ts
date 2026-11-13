/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The Office.js enums a border names.
//
// Values only: which of them a paragraph border writes, and what each one writes, is the host's
// business (`packages/core/src/automation/paragraph-borders.ts`).

/** Office.js border line styles. @public */
export enum BorderLineStyle {
  dashDot = 'DashDot',
  dashDotDot = 'DashDotDot',
  dashDotStroked = 'DashDotStroked',
  dashLargeGap = 'DashLargeGap',
  dashSmallGap = 'DashSmallGap',
  dot = 'Dot',
  double = 'Double',
  doubleWavy = 'DoubleWavy',
  emboss3D = 'Emboss3D',
  engrave3D = 'Engrave3D',
  inset = 'Inset',
  none = 'None',
  outset = 'Outset',
  single = 'Single',
  singleWavy = 'SingleWavy',
  thickThinLargeGap = 'ThickThinLargeGap',
  thickThinMedGap = 'ThickThinMedGap',
  thickThinSmallGap = 'ThickThinSmallGap',
  thinThickLargeGap = 'ThinThickLargeGap',
  thinThickMedGap = 'ThinThickMedGap',
  thinThickSmallGap = 'ThinThickSmallGap',
  thinThickThinLargeGap = 'ThinThickThinLargeGap',
  thinThickThinMedGap = 'ThinThickThinMedGap',
  thinThickThinSmallGap = 'ThinThickThinSmallGap',
  triple = 'Triple',
}

/** Office.js border line widths, in points. @public */
export enum LineWidth {
  pt025 = 'Pt025',
  pt050 = 'Pt050',
  pt075 = 'Pt075',
  pt100 = 'Pt100',
  pt150 = 'Pt150',
  pt225 = 'Pt225',
  pt300 = 'Pt300',
  pt450 = 'Pt450',
  pt600 = 'Pt600',
}

/** Office.js palette colors. @public */
export enum ColorIndex {
  auto = 'Auto',
  black = 'Black',
  blue = 'Blue',
  brightGreen = 'BrightGreen',
  byAuthor = 'ByAuthor',
  classicBlue = 'ClassicBlue',
  classicRed = 'ClassicRed',
  darkBlue = 'DarkBlue',
  darkRed = 'DarkRed',
  darkYellow = 'DarkYellow',
  gray25 = 'Gray25',
  gray50 = 'Gray50',
  green = 'Green',
  pink = 'Pink',
  red = 'Red',
  teal = 'Teal',
  turquoise = 'Turquoise',
  violet = 'Violet',
  white = 'White',
  yellow = 'Yellow',
}

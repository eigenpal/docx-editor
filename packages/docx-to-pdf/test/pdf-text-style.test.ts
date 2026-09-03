/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import type { ResolvedRunStyle } from '@docx-editor.dev/core/layout';
import {
  pdfDisplayText,
  pdfRunStyleApproximations,
  pdfTextStyleFromResolvedRunStyle,
} from '../src/pdf-text-style.ts';

function style(overrides: Partial<ResolvedRunStyle> = {}): ResolvedRunStyle {
  return Object.freeze({
    fontFamily: 'Arial',
    fontFamilyEastAsia: null,
    fontSizePt: 11,
    color: '000000',
    bold: false,
    italic: false,
    underline: null,
    strike: false,
    doubleStrike: false,
    highlight: null,
    shading: null,
    verticalAlign: 'baseline',
    baselineShiftPt: 0,
    caps: false,
    smallCaps: false,
    characterSpacingPt: 0,
    horizontalScalePercent: 100,
    kerningMinPt: 0,
    hidden: false,
    ...overrides,
  });
}

describe('pdfDisplayText', () => {
  test('uppercases w:caps so lowercase source text is not painted', () => {
    expect(pdfDisplayText('Hello ä', style({ caps: true }))).toBe('HELLO Ä');
  });

  test('leaves small-caps characters unchanged', () => {
    expect(pdfDisplayText('Hello', style({ smallCaps: true }))).toBe('Hello');
  });
});

describe('pdfRunStyleApproximations', () => {
  test('does not treat implemented caps as an approximation', () => {
    expect(pdfRunStyleApproximations(style({ caps: true }))).toEqual([]);
  });

  test('lists each unimplemented run effect with a precise feature name', () => {
    const features = pdfRunStyleApproximations(
      style({
        smallCaps: true,
        characterSpacingPt: 0.5,
        horizontalScalePercent: 80,
        highlight: 'yellow',
        shading: 'AABBCC',
      })
    ).map((entry) => entry.feature);
    expect(features).toEqual([
      'small-caps',
      'character-spacing',
      'horizontal-scale',
      'highlight',
      'shading',
    ]);
  });

  test('omits small-caps when caps already supplies display casing', () => {
    expect(pdfRunStyleApproximations(style({ caps: true, smallCaps: true }))).toEqual([]);
  });
});

describe('pdfTextStyleFromResolvedRunStyle', () => {
  test('keeps baseline shift on the style object for writers that must not reapply it', () => {
    expect(pdfTextStyleFromResolvedRunStyle(style({ baselineShiftPt: 3 })).baselineShiftPt).toBe(3);
  });
});

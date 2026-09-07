/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import type {
  HeaderFooterStoryRecord,
  ParagraphFragmentRecord,
} from '@docx-editor.dev/core/layout';
import {
  quantizeWordMacos300Dpi,
  quantizeWordMacos300DpiFooterBaseline,
  quantizeWordMacos300DpiLineRect,
} from '../src/pdf-compatibility-profile.ts';
import { planPdfPaintFromLayout } from '../src/pdf-page-planner.ts';
import { layout, page, paragraph, span } from './pdf-page-planner-fixtures.ts';

const PROFILE = { compatibilityProfile: 'word-macos-300dpi' } as const;

describe('word-macos-300dpi compatibility profile', () => {
  test('uses 0.24 pt half-away-from-zero quantization', () => {
    expect(quantizeWordMacos300Dpi(0.12)).toBeCloseTo(0.24, 12);
    expect(quantizeWordMacos300Dpi(-0.12)).toBeCloseTo(-0.24, 12);
    expect(quantizeWordMacos300Dpi(-0.11)).toBe(-0);
    expect(quantizeWordMacos300Dpi(89.85)).toBeCloseTo(89.76, 12);
  });

  test('floors footer baselines toward the physical page edge', () => {
    expect(quantizeWordMacos300DpiFooterBaseline(37.42)).toBeCloseTo(37.2, 12);
    expect(quantizeWordMacos300DpiFooterBaseline(-0.01)).toBeCloseTo(-0.24, 12);
  });

  test('keeps mixed page sizes independent', () => {
    const result = planPdfPaintFromLayout(
      layout([page(0, 11907 / 20, 16840 / 20), page(1, 792, 612)]),
      PROFILE
    );
    const pages = result.plan.commands.filter((command) => command.kind === 'beginPage');
    expect(pages).toHaveLength(2);
    expect(pages[0]?.width).toBeCloseTo(595.44, 12);
    expect(pages[0]?.height).toBeCloseTo(841.92, 12);
    expect(pages[1]).toMatchObject({ pageIndex: 1, width: 792, height: 612 });
  });

  test('uses the footer baseline phase for footer list markers', () => {
    const markerStyle = span('marker', '', { x: 0, y: 0, width: 0, height: 9 }).style;
    const footerParagraph = paragraph(
      'footer-list',
      'Footer',
      { x: 0, y: 0, width: 468, height: 14 },
      { x: 18, y: 0, width: 36, height: 9 },
      {
        baseline: 9.5,
        marker: Object.freeze({
          text: '1.',
          style: markerStyle,
          box: Object.freeze({ x: 0, y: 0, width: 14, height: 11 }),
          level: 0,
          numId: '1',
          numFmt: 'decimal',
          ordinal: 1,
        }) as ParagraphFragmentRecord['marker'],
      }
    );
    const footer = Object.freeze({
      kind: 'footer',
      variant: 'default',
      partName: 'footer1.xml',
      box: Object.freeze({ x: 72, y: 700, width: 468, height: 36 }),
      fragments: Object.freeze([footerParagraph]),
    }) as HeaderFooterStoryRecord;
    const document = layout([page(0, 612, 792, { footer })]);
    const exact = planPdfPaintFromLayout(document).plan.commands.find(
      (command) => command.kind === 'textSpan' && command.text === '1.'
    );
    const compatible = planPdfPaintFromLayout(document, PROFILE).plan.commands.find(
      (command) => command.kind === 'textSpan' && command.text === '1.'
    );

    expect(exact?.kind === 'textSpan' ? exact.baseline : null).toBeCloseTo(82.5, 12);
    expect(compatible?.kind === 'textSpan' ? compatible.baseline : null).toBeCloseTo(82.32, 12);
  });

  test('quantizes font sizes and cumulative baselines', () => {
    const body = paragraph(
      'p1',
      'Text',
      { x: 0, y: 0, width: 200, height: 12.375 },
      { x: 0, y: 0, width: 30.125, height: 9 },
      { style: { fontSizePt: 9 }, baseline: 9 }
    );
    const result = planPdfPaintFromLayout(
      layout([page(0, 612, 792, { fragments: [body] })]),
      PROFILE
    );
    const text = result.plan.commands.find((command) => command.kind === 'textSpan');
    expect(text?.kind === 'textSpan' ? text.style.fontSizePt : null).toBeCloseTo(9.12, 12);

    const anchors = [100, 112.375, 124.75, 137.125].map(quantizeWordMacos300Dpi);
    const steps = anchors.slice(1).map((value, index) => value - anchors[index]!);
    expect(steps[0]).toBeCloseTo(12.24, 12);
    expect(steps[1]).toBeCloseTo(12.48, 12);
    expect(steps[2]).toBeCloseTo(12.24, 12);
  });

  test('preserves line-relative run advances', () => {
    const first = quantizeWordMacos300DpiLineRect(
      { x: 90.03, y: 10.03, width: 17.137, height: 9 },
      90.03
    );
    const second = quantizeWordMacos300DpiLineRect(
      { x: 107.167, y: 10.03, width: 21.419, height: 9 },
      90.03
    );
    expect(second.x - first.x).toBeCloseTo(17.137, 12);
    expect(first.width).toBe(17.137);
    expect(second.width).toBe(21.419);
  });

  test('snaps link annotations without snapping their text runs', () => {
    const body = paragraph(
      'linked',
      'Link',
      { x: 0, y: 0, width: 200, height: 12 },
      { x: 0.13, y: 0.07, width: 17.137, height: 9 },
      {
        link: {
          id: 'link-1',
          kind: 'external',
          href: 'https://example.com',
        },
      }
    );
    const result = planPdfPaintFromLayout(
      layout([page(0, 612, 792, { fragments: [body] })]),
      PROFILE
    );
    const text = result.plan.commands.find((command) => command.kind === 'textSpan');
    const link = result.plan.commands.find((command) => command.kind === 'link');
    expect(text?.kind === 'textSpan' ? text.rect.x : null).toBeCloseTo(72.13, 12);
    expect(text?.kind === 'textSpan' ? text.rect.width : null).toBeCloseTo(17.137, 12);
    expect(link?.kind === 'link' ? link.rect.x : null).toBeCloseTo(72.24, 12);
    expect(link?.kind === 'link' ? link.rect.width : null).toBeCloseTo(17.04, 12);
  });

  test('quantizes border edges without changing default output', () => {
    const body = paragraph(
      'p1',
      '',
      { x: 0, y: 0, width: 200, height: 12 },
      { x: 0, y: 0, width: 0, height: 9 },
      {
        lineMode: 'none',
        borders: [
          {
            side: 'bottom',
            edge: { val: 'single', color: null, widthPt: 0.5, spacePt: 0 },
            box: { x: 0, y: 10.08, width: 200, height: 0.5 },
          },
        ],
      }
    );
    const document = layout([page(0, 612, 792, { fragments: [body] })]);
    const exact = planPdfPaintFromLayout(document);
    const compatible = planPdfPaintFromLayout(document, PROFILE);
    const exactFill = exact.plan.commands.find((command) => command.kind === 'fillRect');
    const compatibleFill = compatible.plan.commands.find((command) => command.kind === 'fillRect');

    expect(exactFill?.kind === 'fillRect' ? exactFill.rect.height : null).toBe(0.5);
    expect(compatibleFill?.kind === 'fillRect' ? compatibleFill.rect.height : null).toBeCloseTo(
      0.48,
      12
    );
    expect(planPdfPaintFromLayout(document).plan).toEqual(exact.plan);
  });
});

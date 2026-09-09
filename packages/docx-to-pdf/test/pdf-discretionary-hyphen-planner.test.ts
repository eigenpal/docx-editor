/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import type { StyleSpanRecord } from '@docx-editor.dev/core/layout';
import {
  discretionaryHyphenRect,
  plannedDiscretionaryHyphenCommand,
  spanTextWidthPt,
} from '../src/pdf-discretionary-hyphen-planner.ts';
import { planPdfPaintFromLayout } from '../src/pdf-page-planner.ts';
import type { PdfTextSpanCommand } from '../src/pdf-paint-types.ts';
import { layout, page, paragraphFromSpans, span } from './pdf-page-planner-fixtures.ts';

describe('pdf discretionary hyphen planner helpers', () => {
  test('spanTextWidthPt subtracts the published hyphen width', () => {
    const record = Object.freeze({
      discretionaryHyphen: Object.freeze({ widthPt: 6 }),
    }) as StyleSpanRecord;
    expect(spanTextWidthPt(record, 36)).toBe(30);
    expect(spanTextWidthPt(record, 0)).toBe(0);
  });

  test('discretionaryHyphenRect sits at the span box end', () => {
    const record = Object.freeze({
      discretionaryHyphen: Object.freeze({ widthPt: 6 }),
    }) as StyleSpanRecord;
    expect(discretionaryHyphenRect({ x: 10, y: 20, width: 36, height: 11 }, record)).toEqual({
      x: 40,
      y: 20,
      width: 6,
      height: 11,
    });
  });

  test('plannedDiscretionaryHyphenCommand is null without the property', () => {
    expect(
      plannedDiscretionaryHyphenCommand(
        { x: 0, y: 0, width: 30, height: 11 },
        680,
        span('p1', 'word', { x: 0, y: 0, width: 30, height: 11 }),
        {
          fontFamily: 'Arial',
          fontSizePt: 11,
          fontWeight: 'normal',
          italic: false,
          color: '#000000',
          decoration: 'none',
          baselineShiftPt: 0,
        }
      )
    ).toBeNull();
  });
});

describe('planPdfPaintFromLayout discretionary hyphen commands', () => {
  const SINGLE = Object.freeze({ variant: 'single', color: null });

  function hyphenatedSpanRecord(
    text: string,
    prefixWidth: number,
    hyphenWidth: number,
    style: Partial<StyleSpanRecord['style']> = {},
    link?: StyleSpanRecord['link']
  ): StyleSpanRecord {
    return Object.freeze({
      ...span(
        'p1',
        text,
        { x: 0, y: 0, width: prefixWidth + hyphenWidth, height: 11 },
        { underline: SINGLE, fontSizePt: 11, ...style },
        link
      ),
      discretionaryHyphen: Object.freeze({ widthPt: hyphenWidth }),
    }) as StyleSpanRecord;
  }

  test('emits prefix text and a separate hyphen command with matching style and baseline', () => {
    const body = paragraphFromSpans(
      'p1',
      { x: 0, y: 0, width: 468, height: 14 },
      [hyphenatedSpanRecord('citi', 30, 6)],
      { baseline: 10 }
    );
    const result = planPdfPaintFromLayout(layout([page(0, 612, 792, { fragments: [body] })]));
    const textCommands = result.plan.commands.filter(
      (command): command is PdfTextSpanCommand => command.kind === 'textSpan'
    );

    expect(textCommands).toHaveLength(2);
    expect(textCommands[0]!.text).toBe('citi');
    expect(textCommands[0]!.rect.width).toBeCloseTo(30, 5);
    expect(textCommands[1]!.text).toBe('-');
    expect(textCommands[1]!.rect.width).toBeCloseTo(6, 5);
    expect(textCommands[1]!.rect.x).toBeCloseTo(textCommands[0]!.rect.x + 30, 5);
    expect(textCommands[1]!.baseline).toBe(textCommands[0]!.baseline);
    expect(textCommands[1]!.style).toEqual(textCommands[0]!.style);
    expect(textCommands[1]!.style.decoration).toBe('underline');
  });

  test('emits only one text command when discretionaryHyphen is absent', () => {
    const body = paragraphFromSpans(
      'p1',
      { x: 0, y: 0, width: 468, height: 14 },
      [span('p1', 'plain', { x: 0, y: 0, width: 30, height: 11 })],
      { baseline: 10 }
    );
    const result = planPdfPaintFromLayout(layout([page(0, 612, 792, { fragments: [body] })]));
    const textCommands = result.plan.commands.filter((command) => command.kind === 'textSpan');
    expect(textCommands).toHaveLength(1);
    expect(textCommands[0]).toMatchObject({ text: 'plain' });
  });

  test('extends hyperlink annotations to the full span box including the hyphen', () => {
    const body = paragraphFromSpans(
      'p1',
      { x: 0, y: 0, width: 468, height: 14 },
      [
        hyphenatedSpanRecord(
          'link',
          24,
          6,
          {},
          {
            id: 'hl1',
            kind: 'external',
            href: 'https://example.com',
          }
        ),
      ],
      { baseline: 10 }
    );
    const result = planPdfPaintFromLayout(layout([page(0, 612, 792, { fragments: [body] })]));
    const link = result.plan.commands.find((command) => command.kind === 'link');
    const textCommands = result.plan.commands.filter(
      (command): command is PdfTextSpanCommand => command.kind === 'textSpan'
    );

    expect(textCommands).toHaveLength(2);
    expect(link).toMatchObject({
      kind: 'link',
      rect: { width: 30 },
      target: { kind: 'external', href: 'https://example.com' },
    });
  });
});

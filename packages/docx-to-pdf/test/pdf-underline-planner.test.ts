/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { inflateSync } from 'node:zlib';
import type { StyleSpanRecord } from '@docx-editor.dev/core/layout';
import { planPdfPaintFromLayout } from '../src/pdf-page-planner.ts';
import type { PdfPaintCommand, PdfTextSpanCommand } from '../src/pdf-paint-types.ts';
import { writePdfPaintPlanToBytes } from '../src/pdfkit-paint-writer.ts';
import { layout, page, paragraphFromSpans, span } from './pdf-page-planner-fixtures.ts';

/** Confirmed `w:jc=both` inter-span slack on paragraph 38. */
const JUSTIFY_GAP_PT = 7.706;
const PROFILE = { compatibilityProfile: 'word-macos-300dpi' } as const;
const SINGLE = Object.freeze({ variant: 'single', color: null });
const LINE1_WIDTHS = [52, 54, 51, 55, 50, 56, 51.444];

function underlined(
  id: string,
  text: string,
  box: { x: number; y: number; width: number; height: number },
  rangeStart: number,
  style: Partial<StyleSpanRecord['style']> = {},
  extras: { wrapAdvanceBefore?: number; link?: StyleSpanRecord['link'] } = {}
): StyleSpanRecord {
  return span(
    id,
    text,
    box,
    { underline: SINGLE, bold: true, fontSizePt: 11, ...style },
    extras.link,
    { rangeStart, wrapAdvanceBefore: extras.wrapAdvanceBefore }
  );
}

function justifiedLineSpans(
  id: string,
  y: number,
  widths: readonly number[],
  gap: number
): StyleSpanRecord[] {
  const spans: StyleSpanRecord[] = [];
  let x = 0;
  let start = 0;
  for (let index = 0; index < widths.length; index += 1) {
    const width = widths[index]!;
    const isLast = index === widths.length - 1;
    const text = isLast ? 'end' : 'word ';
    spans.push(underlined(id, text, { x, y, width, height: 11 }, start));
    start += text.length;
    x += width + (isLast ? 0 : gap);
  }
  return spans;
}

function pdfContentStreams(bytes: Uint8Array): string {
  const pdf = Buffer.from(bytes);
  const text = pdf.toString('latin1');
  const streams: string[] = [];
  for (const match of text.matchAll(/\/Filter \/FlateDecode\s*>>\s*stream\n/g)) {
    const start = match.index! + match[0].length;
    const end = text.indexOf('\nendstream', start);
    if (end < 0) continue;
    streams.push(inflateSync(pdf.subarray(start, end)).toString('latin1'));
  }
  return streams.join('\n');
}

function fillRects(content: string): { x: number; y: number; width: number; height: number }[] {
  const rects: { x: number; y: number; width: number; height: number }[] = [];
  const re =
    /([+-]?(?:\d+\.\d*|\.\d+|\d+))\s+([+-]?(?:\d+\.\d*|\.\d+|\d+))\s+([+-]?(?:\d+\.\d*|\.\d+|\d+))\s+([+-]?(?:\d+\.\d*|\.\d+|\d+))\s+re/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    const after = content.slice(match.index + match[0].length, match.index + match[0].length + 8);
    if (!/\s*f\b/.test(after)) continue;
    rects.push({
      x: Number(match[1]),
      y: Number(match[2]),
      width: Number(match[3]),
      height: Number(match[4]),
    });
  }
  return rects;
}

function textSpans(commands: readonly PdfPaintCommand[]): PdfTextSpanCommand[] {
  return commands.filter((command): command is PdfTextSpanCommand => command.kind === 'textSpan');
}

describe('planner underline gap absorption', () => {
  test('paints one continuous line-1 underline under word-macos-300dpi', async () => {
    const line1 = justifiedLineSpans('p38', 0, LINE1_WIDTHS, JUSTIFY_GAP_PT);
    const line2 = [
      underlined('p38', 'Last ', { x: 0, y: 20, width: 40, height: 11 }, 40),
      underlined('p38', 'line', { x: 40, y: 20, width: 40, height: 11 }, 46),
    ];
    const body = paragraphFromSpans('p38', { x: 0, y: 0, width: 468, height: 36 }, line1, {
      baseline: 9.5,
      lines: [
        { box: { x: 0, y: 0, width: 468, height: 14 }, spans: line1, baseline: 9.5 },
        { box: { x: 0, y: 20, width: 468, height: 14 }, spans: line2, baseline: 9.5 },
      ],
    });
    const document = layout([page(0, 612, 792, { fragments: [body] })]);
    const exact = planPdfPaintFromLayout(document);
    expect(
      textSpans(exact.plan.commands).every(
        (command) => command.underlineGapAbsorptionPt === undefined
      )
    ).toBe(true);
    const exactResult = await writePdfPaintPlanToBytes(exact.plan);
    expect(fillRects(pdfContentStreams(exactResult.bytes))).toHaveLength(8);

    const planned = planPdfPaintFromLayout(document, PROFILE);
    const spans = textSpans(planned.plan.commands);
    expect(spans).toHaveLength(9);
    for (const command of spans.slice(0, 6)) {
      expect(command.underlineGapAbsorptionPt).toBeCloseTo(JUSTIFY_GAP_PT, 10);
    }
    expect(spans[6]?.underlineGapAbsorptionPt).toBeUndefined();
    expect(spans[7]?.underlineGapAbsorptionPt).toBeUndefined();
    expect(spans[8]?.underlineGapAbsorptionPt).toBeUndefined();

    const result = await writePdfPaintPlanToBytes(planned.plan);
    const fills = fillRects(pdfContentStreams(result.bytes));
    expect(fills).toHaveLength(2);
    expect(fills[0]!.width).toBeCloseTo(415.68, 5);
    expect(fills[1]!.width).toBeCloseTo(80, 5);
  });

  test('does not infer absorption from an x gap alone', () => {
    const planned = planPdfPaintFromLayout(
      layout([
        page(0, 612, 792, {
          fragments: [
            paragraphFromSpans('gap', { x: 0, y: 0, width: 200, height: 14 }, [
              underlined('gap', 'word', { x: 0, y: 0, width: 40, height: 11 }, 0),
              underlined('gap', 'next', { x: 40 + JUSTIFY_GAP_PT, y: 0, width: 40, height: 11 }, 4),
            ]),
          ],
        }),
      ])
    );
    expect(textSpans(planned.plan.commands)[0]?.underlineGapAbsorptionPt).toBeUndefined();
  });

  test('does not absorb through non-underlined middle text', async () => {
    const planned = planPdfPaintFromLayout(
      layout([
        page(0, 612, 792, {
          fragments: [
            paragraphFromSpans('mid', { x: 0, y: 0, width: 200, height: 14 }, [
              underlined('mid', 'ab ', { x: 0, y: 0, width: 40, height: 11 }, 0),
              span(
                'mid',
                'mid',
                { x: 40 + JUSTIFY_GAP_PT, y: 0, width: 30, height: 11 },
                {},
                undefined,
                {
                  rangeStart: 3,
                }
              ),
              underlined(
                'mid',
                'cd',
                { x: 70 + 2 * JUSTIFY_GAP_PT, y: 0, width: 40, height: 11 },
                6
              ),
            ]),
          ],
        }),
      ])
    );
    const spans = textSpans(planned.plan.commands);
    expect(spans[0]?.underlineGapAbsorptionPt).toBeUndefined();
    const result = await writePdfPaintPlanToBytes(planned.plan);
    expect(fillRects(pdfContentStreams(result.bytes))).toHaveLength(2);
  });

  test('does not absorb wrapAdvanceBefore', async () => {
    const planned = planPdfPaintFromLayout(
      layout([
        page(0, 612, 792, {
          fragments: [
            paragraphFromSpans('wrap', { x: 0, y: 0, width: 200, height: 14 }, [
              underlined('wrap', 'ab ', { x: 0, y: 0, width: 40, height: 11 }, 0),
              underlined(
                'wrap',
                'cd',
                { x: 58, y: 0, width: 40, height: 11 },
                3,
                {},
                { wrapAdvanceBefore: 18 }
              ),
            ]),
          ],
        }),
      ])
    );
    expect(textSpans(planned.plan.commands)[0]?.underlineGapAbsorptionPt).toBeUndefined();
    const result = await writePdfPaintPlanToBytes(planned.plan);
    expect(fillRects(pdfContentStreams(result.bytes))).toHaveLength(2);
  });

  test('does not absorb a tab or an image in the gap', async () => {
    const withTab = planPdfPaintFromLayout(
      layout([
        page(0, 612, 792, {
          fragments: [
            paragraphFromSpans('tab', { x: 0, y: 0, width: 200, height: 14 }, [
              underlined('tab', 'ab ', { x: 0, y: 0, width: 40, height: 11 }, 0),
              span('tab', '\t', { x: 40, y: 0, width: JUSTIFY_GAP_PT, height: 11 }, {}, undefined, {
                rangeStart: 3,
              }),
              underlined('tab', 'cd', { x: 40 + JUSTIFY_GAP_PT, y: 0, width: 40, height: 11 }, 4),
            ]),
          ],
        }),
      ])
    );
    const withImage = planPdfPaintFromLayout(
      layout([
        page(0, 612, 792, {
          fragments: [
            paragraphFromSpans(
              'img',
              { x: 0, y: 0, width: 200, height: 14 },
              [
                underlined('img', 'ab ', { x: 0, y: 0, width: 40, height: 11 }, 0),
                underlined('img', 'cd', { x: 40 + JUSTIFY_GAP_PT, y: 0, width: 40, height: 11 }, 4),
              ],
              {
                drawings: [
                  {
                    paragraphId: 'img',
                    start: 3,
                    advanceStart: 40,
                    advanceEnd: 40 + JUSTIFY_GAP_PT,
                    baselineOffset: 11,
                  },
                ],
              }
            ),
          ],
        }),
      ])
    );
    expect(textSpans(withTab.plan.commands)[0]?.underlineGapAbsorptionPt).toBeUndefined();
    expect(textSpans(withImage.plan.commands)[0]?.underlineGapAbsorptionPt).toBeUndefined();
    expect(
      fillRects(pdfContentStreams((await writePdfPaintPlanToBytes(withTab.plan)).bytes))
    ).toHaveLength(2);
    expect(
      fillRects(pdfContentStreams((await writePdfPaintPlanToBytes(withImage.plan)).bytes))
    ).toHaveLength(2);
  });

  test('keeps link, colour, and size splits', async () => {
    const rightX = 40 + JUSTIFY_GAP_PT;
    const links = planPdfPaintFromLayout(
      layout([
        page(0, 612, 792, {
          fragments: [
            paragraphFromSpans('link', { x: 0, y: 0, width: 200, height: 14 }, [
              underlined('link', 'aa ', { x: 0, y: 0, width: 40, height: 11 }, 0),
              underlined(
                'link',
                'bb',
                { x: rightX, y: 0, width: 40, height: 11 },
                3,
                {},
                { link: { id: 'l1', kind: 'external', href: 'https://example.com' } }
              ),
            ]),
          ],
        }),
      ]),
      PROFILE
    );
    const colour = planPdfPaintFromLayout(
      layout([
        page(0, 612, 792, {
          fragments: [
            paragraphFromSpans('col', { x: 0, y: 0, width: 200, height: 14 }, [
              underlined('col', 'aa ', { x: 0, y: 0, width: 40, height: 11 }, 0),
              underlined('col', 'bb', { x: rightX, y: 0, width: 40, height: 11 }, 3, {
                color: 'FF0000',
              }),
            ]),
          ],
        }),
      ]),
      PROFILE
    );
    const size = planPdfPaintFromLayout(
      layout([
        page(0, 612, 792, {
          fragments: [
            paragraphFromSpans('sz', { x: 0, y: 0, width: 200, height: 14 }, [
              underlined('sz', 'aa ', { x: 0, y: 0, width: 40, height: 11 }, 0),
              underlined('sz', 'bb', { x: rightX, y: 0, width: 40, height: 14 }, 3, {
                fontSizePt: 14,
              }),
            ]),
          ],
        }),
      ]),
      PROFILE
    );
    expect(textSpans(links.plan.commands)[0]?.underlineGapAbsorptionPt).toBeUndefined();
    expect(textSpans(colour.plan.commands)[0]?.underlineGapAbsorptionPt).toBeCloseTo(
      JUSTIFY_GAP_PT,
      10
    );
    expect(textSpans(size.plan.commands)[0]?.underlineGapAbsorptionPt).toBeCloseTo(
      JUSTIFY_GAP_PT,
      10
    );
    expect(
      fillRects(pdfContentStreams((await writePdfPaintPlanToBytes(links.plan)).bytes))
    ).toHaveLength(2);
    expect(
      fillRects(pdfContentStreams((await writePdfPaintPlanToBytes(colour.plan)).bytes))
    ).toHaveLength(2);
    expect(
      fillRects(pdfContentStreams((await writePdfPaintPlanToBytes(size.plan)).bytes))
    ).toHaveLength(2);
  });
});

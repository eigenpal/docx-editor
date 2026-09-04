// Word-compatible wrap: hanging U+0020, justified shrink, NBSP stays glued.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { DEFAULT_RUN_STYLE, type ResolvedRunStyle } from '../run-style.ts';
import { breakParagraph, alignSpans } from '../paragraph-flow.ts';
import {
  candidateNeedsWrap,
  distributeCappedShrink,
  hangingBoundarySpaceWidth,
  minExpandableSpaceWidth,
  stripTrailingOrdinarySpaces,
  visibleCandidateWidth,
} from '../paragraph-justify.ts';
import type { StyleSpanRecord, TextMeasurer } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);

function paragraph(body: string): OoxmlNode {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  const found = result.part.root.children[0]!.children.find((child) => child.kind === 'paragraph');
  if (!found) throw new Error('no paragraph');
  return found;
}

const run = (text: string, rPr = '<w:sz w:val="22"/>') =>
  `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

const linesOf = (body: string, width: number, used: TextMeasurer = measurer) =>
  breakParagraph(paragraph(body), 'p', 0, width, used, undefined, null);

const textsOf = (body: string, width: number, used: TextMeasurer = measurer) =>
  linesOf(body, width, used).map((line) => line.spans.map((span) => span.text).join(''));

describe('hanging U+0020 during overflow', () => {
  test('trailing ordinary spaces do not decide whether the visible word fits', () => {
    // 6pt/glyph, 60pt line: "aaaaaa " is 42pt. Visible "bbb" is 18pt and fits;
    // "bbb " at 24pt would wrap if the trailing space consumed fit width.
    expect(textsOf(`<w:p>${run('aaaaaa bbb c')}</w:p>`, 60)).toEqual(['aaaaaa bbb ', 'c']);
  });

  test('a connecting U+0020 does not keep a left-aligned word that overflows naturally', () => {
    // Prefix 36pt + connector 6pt + "bbbbb" 30pt = 72pt over a 60pt line. Word wraps.
    expect(textsOf(`<w:p>${run('aaaaa bbbbb c')}</w:p>`, 60)).toEqual(['aaaaa ', 'bbbbb c']);
  });

  test('NBSP is not a wrap boundary and is not stripped as a hanging space', () => {
    const lines = textsOf(`<w:p>${run('aa a\u00a0bbbbb extra')}</w:p>`, 48);
    expect(lines.some((line) => line.includes('a\u00a0bbbbb'))).toBe(true);
    expect(lines.join('|')).not.toContain('a\n');
    expect(stripTrailingOrdinarySpaces('a\u00a0bbbbb ')).toBe('a\u00a0bbbbb');
  });
});

describe('justified shrink of expandable spaces', () => {
  // "aa bb cc " = 54pt, visible "dd" = 12pt, natural 66pt. Three spaces, floor 3pt, budget 9pt.
  const KEEP = `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${run('aa bb cc dd extra')}</w:p>`;

  test('a non-final justified line keeps a word when shrink covers the overflow', () => {
    const lines = textsOf(KEEP, 60);
    expect(lines[0]).toContain('dd');
    expect(lines.join('')).toContain('extra');
    expect(lines[0]).not.toContain('extra');
  });

  test('alignSpans compresses expandable spaces and preserves expansion on slack', () => {
    const pending = linesOf(KEEP, 60);
    expect(pending.length).toBeGreaterThan(1);
    const shrunk = alignSpans(pending[0]!.spans, measurer, 0, 60, 'both', false);
    const last = shrunk[shrunk.length - 1]!;
    const visible = last.text.replace(/ +$/u, '');
    const visibleWidth = measurer.measure(visible, last.style);
    expect(last.box.x + visibleWidth).toBeLessThanOrEqual(60 + 0.001);
    const gap = shrunk[1]!.box.x - (shrunk[0]!.box.x + shrunk[0]!.box.width);
    expect(gap).toBeLessThanOrEqual(0.001);
    expect(shrunk[0]!.box.width).toBeLessThan(pending[0]!.spans[0]!.box.width);

    const stretched = alignSpans(pending[0]!.spans, measurer, 0, 90, 'both', false);
    expect(stretched[1]!.box.x).toBeGreaterThan(
      stretched[0]!.box.x + stretched[0]!.box.width + 0.25
    );
  });

  test('the last justified line does not shrink, so the overflowing word wraps', () => {
    const lines = textsOf(
      `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${run('aa bb cc dd')}</w:p>`,
      60
    );
    expect(lines).toEqual(['aa bb cc ', 'dd']);
    const last = alignSpans(
      linesOf(`<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${run('aa bb cc dd')}</w:p>`, 60)[1]!.spans,
      measurer,
      0,
      60,
      'both',
      true
    );
    expect(last[0]!.box.x).toBe(0);
  });

  test('non-justified lines do not shrink to keep the word', () => {
    expect(textsOf(`<w:p>${run('aa bb cc dd extra')}</w:p>`, 60)[0]).toBe('aa bb cc ');
  });

  test('shrink stops at the em/space floor and the word wraps when over budget', () => {
    // needed = 66 - 56 = 10pt, budget = 3 spaces × 3pt = 9pt.
    expect(textsOf(KEEP, 56)[0]).toBe('aa bb cc ');
    expect(minExpandableSpaceWidth(6, 11)).toBe(3);
    expect(minExpandableSpaceWidth(2.75, 11)).toBeCloseTo(11 / 6, 5);
  });

  test('model text stays on the spans after shrink', () => {
    const pending = linesOf(KEEP, 60);
    const aligned = alignSpans(pending[0]!.spans, measurer, 0, 60, 'both', false);
    expect(aligned.map((span) => span.text).join('')).toBe(
      pending[0]!.spans.map((s) => s.text).join('')
    );
    expect(aligned.reduce((sum, span) => sum + (span.range.end - span.range.start), 0)).toBe(
      pending[0]!.spans.reduce((sum, span) => sum + (span.range.end - span.range.start), 0)
    );
  });
});

describe('EP_ZMVZ_MULTI_v4 italic wrap regression', () => {
  const SPACE = 2.75;
  const PREFIX = 356.791;
  const VISIBLE = 58.542;
  const AVAIL = 415.65;
  const WORD = (PREFIX - 9 * SPACE) / 10;
  const GLUE = ' a\u00a0zapisovateľom ';

  const fixtureMeasurer: TextMeasurer = {
    measure: (text) => {
      if (text === ' ') return SPACE;
      if (text === 'w') return WORD;
      if (text === 'w ') return WORD + SPACE;
      if (text === 'a\u00a0zapisovateľom') return VISIBLE;
      if (text === 'a\u00a0zapisovateľom ') return VISIBLE + SPACE;
      if (text === 'tail') return 80;
      return text.length * 6;
    },
    lineMetrics: () => ({ height: 14, baseline: 11 }),
  };

  const body =
    `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>` +
    run('w w w w w w w w w w') +
    run(GLUE, '<w:sz w:val="22"/><w:i/>') +
    run('tail') +
    `</w:p>`;

  test('keeps the NBSP-glued word on line 1 at 415.65pt', () => {
    const lines = linesOf(body, AVAIL, fixtureMeasurer);
    expect(lines[0]!.spans.map((span) => span.text).join('')).toContain('a\u00a0zapisovateľom');
    expect(lines[0]!.spans.map((span) => span.text).join('')).not.toContain('tail');
    expect(lines.some((line) => line.spans.some((span) => span.text.includes('tail')))).toBe(true);
    const glued = lines[0]!.spans.filter((span) => span.text.includes('zapisovateľom'));
    expect(glued).toHaveLength(1);
    expect(glued[0]!.text).toBe('a\u00a0zapisovateľom ');

    const aligned = alignSpans(lines[0]!.spans, fixtureMeasurer, 0, AVAIL, 'both', false);
    const last = aligned[aligned.length - 1]!;
    const visible = last.text.replace(/ +$/u, '');
    const visibleWidth = fixtureMeasurer.measure(visible, last.style);
    expect(last.box.x + visibleWidth).toBeLessThanOrEqual(AVAIL + 0.05);
  });
});

describe('justify helpers', () => {
  test('visibleCandidateWidth omits trailing U+0020 and zeros a connector', () => {
    const style = { ...DEFAULT_RUN_STYLE, fontSizePt: 11 };
    expect(visibleCandidateWidth(' ', 6, style, measurer)).toBe(0);
    expect(visibleCandidateWidth('bbb ', 24, style, measurer)).toBe(18);
    expect(visibleCandidateWidth('a\u00a0bb', 18, style, measurer)).toBe(18);
  });

  test('candidateNeedsWrap matches trailing omit, shrink, and floor', () => {
    expect(
      candidateNeedsWrap({
        lineWidth: 42,
        visibleWidth: 18,
        available: 60,
        allowShrink: false,
        shrinkBudget: 0,
      })
    ).toBe(false);
    expect(
      candidateNeedsWrap({
        lineWidth: 54,
        visibleWidth: 12,
        available: 60,
        allowShrink: false,
        shrinkBudget: 9,
      })
    ).toBe(true);
    expect(
      candidateNeedsWrap({
        lineWidth: 54,
        visibleWidth: 12,
        available: 60,
        allowShrink: true,
        shrinkBudget: 9,
      })
    ).toBe(false);
    expect(
      candidateNeedsWrap({
        lineWidth: 54,
        visibleWidth: 12,
        available: 56,
        allowShrink: true,
        shrinkBudget: 9,
      })
    ).toBe(true);
  });

  test('distributeCappedShrink never exceeds the per-slot floor capacity', () => {
    expect(distributeCappedShrink(6, [3, 3, 3])).toEqual([2, 2, 2]);
    expect(distributeCappedShrink(10, [3, 3, 3])).toEqual([3, 3, 3]);
  });

  test('hangingBoundarySpaceWidth reads a committed connector', () => {
    const style: ResolvedRunStyle = { ...DEFAULT_RUN_STYLE, fontSizePt: 11 };
    const spans: StyleSpanRecord[] = [
      {
        range: { paragraphId: 'p', start: 0, end: 3 },
        text: 'aa',
        props: [],
        style,
        box: { x: 0, y: 0, width: 12, height: 14 },
      },
      {
        range: { paragraphId: 'p', start: 3, end: 4 },
        text: ' ',
        props: [],
        style,
        box: { x: 12, y: 0, width: 6, height: 14 },
      },
    ];
    expect(hangingBoundarySpaceWidth(spans, measurer)).toBe(6);
  });
});

describe('center and right hang trailing U+0020', () => {
  const style: ResolvedRunStyle = { ...DEFAULT_RUN_STYLE, fontSizePt: 11 };

  function span(text: string, width: number, start = 0): StyleSpanRecord {
    return {
      range: { paragraphId: 'p', start, end: start + text.length },
      text,
      props: [],
      style,
      box: { x: 0, y: 0, width, height: 14 },
    };
  }

  test('center excludes trailing U+0020 even when lineUsedWidth includes it', () => {
    // "TITLE " is 36pt at 6pt/glyph. Visible 30pt; caller passes the 36pt pending width.
    const spans = [span('TITLE ', 36)];
    const aligned = alignSpans(spans, measurer, 0, 100, 'center', true, 36);
    expect(aligned[0]!.box.x).toBeCloseTo((100 - 30) / 2, 5);
    expect(aligned[0]!.text).toBe('TITLE ');
    expect(aligned[0]!.range).toEqual(spans[0]!.range);
    expect(aligned[0]!.box.width).toBe(36);
  });

  test('right hangs trailing U+0020 so visible glyphs meet the edge', () => {
    const spans = [span('TITLE ', 36)];
    const aligned = alignSpans(spans, measurer, 0, 100, 'right', true, 36);
    expect(aligned[0]!.box.x + 30).toBeCloseTo(100, 5);
    expect(aligned[0]!.box.x + aligned[0]!.box.width).toBeCloseTo(106, 5);
    expect(aligned[0]!.text).toBe('TITLE ');
  });

  test('multiple trailing U+0020 hang as one collapsible tail', () => {
    const spans = [span('AB   ', 30)];
    const aligned = alignSpans(spans, measurer, 0, 90, 'center', true, 30);
    expect(aligned[0]!.box.x).toBeCloseTo((90 - 12) / 2, 5);
    expect(aligned[0]!.text).toBe('AB   ');
  });

  test('a trailing NBSP is not hung', () => {
    const spans = [span('AB\u00a0', 18)];
    const centered = alignSpans(spans, measurer, 0, 90, 'center', true, 18);
    const right = alignSpans(spans, measurer, 0, 90, 'right', true, 18);
    expect(centered[0]!.box.x).toBeCloseTo((90 - 18) / 2, 5);
    expect(right[0]!.box.x + 18).toBeCloseTo(90, 5);
  });

  test('interior U+0020 stays inside the aligned width', () => {
    const spans = [span('AB CD', 30)];
    const centered = alignSpans(spans, measurer, 0, 90, 'center', true, 30);
    expect(centered[0]!.box.x).toBeCloseTo((90 - 30) / 2, 5);
  });

  test('a pure U+0020 span is not hung, so a following drawing can still count it', () => {
    const text = span('x', 6);
    const space: StyleSpanRecord = {
      ...span(' ', 6, 1),
      box: { x: 6, y: 0, width: 6, height: 14 },
    };
    const aligned = alignSpans([text, space], measurer, 0, 90, 'center', true, 12);
    expect(aligned[0]!.box.x).toBeCloseTo((90 - 12) / 2, 5);
  });

  test('left alignment does not shift a trailing space', () => {
    const spans = [span('TITLE ', 36)];
    const aligned = alignSpans(spans, measurer, 0, 100, 'left', true, 36);
    expect(aligned[0]!.box.x).toBe(0);
    expect(aligned[0]).toBe(spans[0]);
  });

  test('justified last line stays flush left with a trailing space', () => {
    const spans = [span('TITLE ', 36)];
    const aligned = alignSpans(spans, measurer, 0, 100, 'both', true, 36);
    expect(aligned[0]!.box.x).toBe(0);
  });

  test('EP_ZMVZ_MULTI_v4 title hangs 3pt and centers 355.869pt', () => {
    const VISIBLE = 355.869;
    const SPACE = 3;
    const USED = VISIBLE + SPACE;
    const AVAIL = 500;
    const titleMeasurer: TextMeasurer = {
      measure: (text) => {
        const visible = text.replace(/ +$/u, '');
        if (visible.length === 0) return text.length * SPACE;
        return VISIBLE + (text.length - visible.length) * SPACE;
      },
      lineMetrics: () => ({ height: 14, baseline: 11 }),
    };
    const spans = [span('ZÁPISNICA ', USED)];
    const aligned = alignSpans(spans, titleMeasurer, 0, AVAIL, 'center', true, USED);
    expect(aligned[0]!.box.x).toBeCloseTo((AVAIL - VISIBLE) / 2, 5);
    expect(aligned[0]!.box.x).toBeCloseTo((AVAIL - USED) / 2 + 1.5, 5);
    expect(aligned[0]!.text).toBe('ZÁPISNICA ');
  });
});

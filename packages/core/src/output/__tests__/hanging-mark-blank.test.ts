import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { describe, expect, test } from 'bun:test';
import {
  loadFixture,
  type FixtureOptions,
} from '../../layout/__tests__/punctuation-kerning-fixture.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

// 19 ideographs and a 24 pt mark take 480 pt. A measure of 480 - overflow pt puts the mark over
// the margin by that overflow: 6 pt hangs only its 12 pt blank half, 18 pt hangs it whole.
const H = '国'.repeat(19);
const hanging = (overflow: number, options: FixtureOptions = {}, mark = '。') =>
  loadFixture({
    text: H + mark + '余',
    available: 480 - overflow,
    language: 'ja-JP',
    compatibility: 15,
    compression: 'compressPunctuation',
    highlight: true,
    paragraphProperties: '<w:jc w:val="both"/><w:overflowPunct/>',
    ...options,
  });

function paintedRuns(fixture: ReturnType<typeof loadFixture>): HTMLElement[] {
  const container = document.createElement('div');
  paintSemanticLayout(container, fixture.layout, { scale: 2 });
  const line = container.querySelector<HTMLElement>('.docx-line')!;
  return [...line.querySelectorAll<HTMLElement>('.layout-run-text')];
}

describe('a hanging mark gives up its compressed trailing blank', () => {
  for (const overflow of [6, 18]) {
    for (const compression of ['compressPunctuation', 'compressPunctuationAndJapaneseKana']) {
      test(`${compression}, overflow ${overflow}: the line records the blank half`, () => {
        const line = hanging(overflow, { compression }).lines[0]!;
        expect(line.spans.map((span) => span.text).join('')).toBe(H + '。');
        expect(line.hangingMarkBlank).toBeCloseTo(12, 6);
        const mark = line.spans.at(-1)!;
        // The glyph and its box keep their places: the whole mark or only its blank half hangs.
        const right = line.box.x + line.box.width;
        expect(mark.box.x + mark.box.width - right).toBeCloseTo(overflow > 12 ? 24 : 12, 6);
      });
    }
  }

  test('paint clips the marks of the final span to the part before the blank', () => {
    for (const overflow of [6, 18]) {
      const runs = paintedRuns(hanging(overflow));
      // 24 pt mark, 12 pt blank, scale 2: the marks keep 24 px of the mark's box.
      expect(runs.at(-1)!.style.clipPath).toBe('inset(-1em calc(100% - 24px) -1em -1em)');
      for (const run of runs.slice(0, -1)) expect(run.style.clipPath).toBe('');
    }
  });

  test('the clip is measured from the left edge of a longer final span', () => {
    // A legacy left-aligned line keeps its text in one span; the 6 pt trailing quarter hangs.
    const fixture = hanging(9, {
      language: 'zh-TW',
      compatibility: 14,
      paragraphProperties: '<w:jc w:val="left"/><w:overflowPunct/>',
    });
    const mark = fixture.lines[0]!.spans.at(-1)!;
    expect(mark.text).toBe(H + '。');
    expect(fixture.lines[0]!.hangingMarkBlank).toBeCloseTo(6, 6);
    expect(paintedRuns(fixture).at(-1)!.style.clipPath).toBe(
      `inset(-1em calc(100% - ${(mark.box.width - 6) * 2}px) -1em -1em)`
    );
  });

  test('a horizontally scaled mark clips in its unscaled coordinates', () => {
    const fixture = hanging(18, { runProperties: '<w:w w:val="50"/>' });
    const line = fixture.lines[0]!;
    const mark = line.spans.at(-1)!;
    expect(mark.text).toBe('。');
    // The fixture measurer keeps the 24 pt advance under `w:w`, so the blank half is 12 pt.
    const blank = line.hangingMarkBlank!;
    expect(mark.box.width).toBeCloseTo(24, 6);
    expect(blank).toBeCloseTo(12, 6);
    const run = paintedRuns(fixture).at(-1)!;
    expect(run.style.transform).toBe('scaleX(0.5)');
    expect(run.style.clipPath).toBe(
      `inset(-1em calc(100% - ${((mark.box.width - blank) * 2) / 0.5}px) -1em -1em)`
    );
  });

  test('a table cell keeps the blank on its line', () => {
    // A 474 pt cell without cell margins: the mark overflows it by 6 pt and hangs its blank half.
    const wrapParagraph = (paragraph: string) =>
      '<w:tbl><w:tblPr><w:tblW w:w="9480" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
      '</w:tblPr><w:tblGrid><w:gridCol w:w="9480"/></w:tblGrid><w:tr><w:tc><w:tcPr>' +
      `<w:tcW w:w="9480" w:type="dxa"/></w:tcPr>${paragraph}</w:tc></w:tr></w:tbl><w:p/>`;
    const fixture = hanging(0, { wrapParagraph, available: 480 });
    const line = fixture.lines.find((each) => each.spans.at(-1)?.text === '。')!;
    expect(line.hangingMarkBlank).toBeCloseTo(12, 6);
    const container = document.createElement('div');
    paintSemanticLayout(container, fixture.layout, { scale: 2 });
    const mark = [...container.querySelectorAll<HTMLElement>('.layout-run-text')].find((run) =>
      run.textContent?.endsWith('。')
    )!;
    expect(mark.style.clipPath).toBe('inset(-1em calc(100% - 24px) -1em -1em)');
  });

  test('a manual break after the mark keeps the clip on the mark', () => {
    const fixture = loadFixture({
      text: H + '。',
      available: 474,
      language: 'ja-JP',
      compatibility: 15,
      compression: 'compressPunctuation',
      highlight: true,
      paragraphProperties: '<w:jc w:val="both"/><w:overflowPunct/>',
      wrapParagraph: (paragraph) =>
        paragraph.replace(
          '</w:p>',
          '<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:br/><w:t>余</w:t></w:r></w:p>'
        ),
    });
    expect(fixture.lines[0]!.hangingMarkBlank).toBeCloseTo(12, 6);
    const runs = paintedRuns(fixture);
    const mark = runs.find((run) => run.textContent?.endsWith('。'))!;
    expect(mark.style.clipPath).toBe('inset(-1em calc(100% - 24px) -1em -1em)');
  });

  test('a tracked insertion clips its revision marks before the blank', () => {
    const fixture = hanging(6, {
      wrapParagraph: (paragraph) =>
        paragraph.replace(
          /(<w:r>.*<\/w:r>)/,
          '<w:ins w:id="1" w:author="Reviewer" w:date="2026-01-01T00:00:00Z">$1</w:ins>'
        ),
    });
    const line = fixture.lines[0]!;
    expect(line.spans.at(-1)!.revisions?.length).toBeGreaterThan(0);
    expect(line.hangingMarkBlank).toBeCloseTo(12, 6);
    expect(paintedRuns(fixture).at(-1)!.style.clipPath).toBe(
      'inset(-1em calc(100% - 24px) -1em -1em)'
    );
  });

  test('a Traditional Chinese mark gives up its trailing quarter', () => {
    for (const overflow of [3, 18]) {
      const line = hanging(overflow, { language: 'zh-TW' }, '、').lines[0]!;
      expect(line.hangingMarkBlank).toBeCloseTo(6, 6);
    }
  });

  test('a left-to-right line with a right-to-left word clips the mark too', () => {
    const fixture = loadFixture({
      text: 'א' + H.slice(1) + '。余',
      available: 462,
      language: 'ja-JP',
      compatibility: 15,
      compression: 'compressPunctuation',
      highlight: true,
      paragraphProperties: '<w:jc w:val="both"/><w:overflowPunct/>',
    });
    const line = fixture.lines[0]!;
    expect(line.spans.some((span) => span.style.shaping !== undefined)).toBe(true);
    expect(line.hangingMarkBlank).toBeCloseTo(12, 6);
    const kept = (line.spans.at(-1)!.box.width - 12) * 2;
    expect(paintedRuns(fixture).at(-1)!.style.clipPath).toBe(
      `inset(-1em calc(100% - ${kept}px) -1em -1em)`
    );
  });

  test('a face that inks into the blank keeps the marks over the glyph', () => {
    // The face centers `。` in its 24 pt cell: ink from 8 to 16 pt leaves an 8 pt blank.
    const measurer = {
      measure: (text: string, style: { fontSizePt: number; characterSpacingPt: number }) =>
        [...text].length * (style.fontSizePt + style.characterSpacingPt),
      lineMetrics: (style: { fontSizePt: number }) => ({
        height: style.fontSizePt * 1.2,
        baseline: style.fontSizePt,
      }),
      inkBounds: (text: string) => (text === '。' ? { left: 8, right: 16 } : undefined),
    };
    const line = hanging(18, { measurer }).lines[0]!;
    expect(line.hangingMarkBlank).toBeCloseTo(8, 6);
  });

  test('character spacing widens the trailing blank', () => {
    // 2 pt spacing: 26 pt cells, 520 pt in all; the mark's trailing blank is 12 + 2 pt.
    const line = hanging(0, { tracking: 40, available: 500 }).lines[0]!;
    expect(line.spans.map((span) => span.text).join('')).toBe(H + '。');
    expect(line.hangingMarkBlank).toBeCloseTo(14, 6);
  });
});

describe('a hanging mark keeps its whole marks', () => {
  const cases: [string, number, FixtureOptions, string?][] = [
    ['without compression', 6, { compression: 'doNotCompress' }],
    ['for a mark without a blank side', 6, { language: 'zh-CN' }, '？'],
    ['for a half-width mark', 6, {}, '.'],
    ['in a Korean run', 6, { language: 'ko-KR' }],
    ['when the mark fits', 0, {}],
  ];
  for (const [name, overflow, options, mark] of cases) {
    test(name, () => {
      const fixture = hanging(overflow, options, mark);
      expect(fixture.lines[0]!.hangingMarkBlank).toBeUndefined();
      for (const run of paintedRuns(fixture)) expect(run.style.clipPath).toBe('');
    });
  }

  test('after a closing mark in the next run carries the hanging mark away', () => {
    // `」` cannot start a line, so `国。` moves to the next line with it.
    for (const compression of ['compressPunctuation', 'doNotCompress']) {
      for (const overflow of [6, 18]) {
        const fixture = loadFixture({
          text: H + '。」余',
          split: 20,
          available: 480 - overflow,
          language: 'ja-JP',
          compatibility: 15,
          compression,
          highlight: true,
          paragraphProperties: '<w:jc w:val="both"/><w:overflowPunct/>',
        });
        const [first, second] = fixture.lines;
        expect(second!.spans.map((span) => span.text).join('')).toBe('国。」余');
        expect(first!.hangingMarkBlank).toBeUndefined();
        // The justified line ends at its margin: no hang remains to stretch it past.
        const last = first!.spans.at(-1)!;
        expect(last.box.x + last.box.width).toBeCloseTo(first!.box.x + first!.box.width, 6);
        for (const run of paintedRuns(fixture)) expect(run.style.clipPath).toBe('');
      }
    }
  });

  test('in a right-to-left paragraph', () => {
    const fixture = hanging(6, {
      paragraphProperties: '<w:bidi/><w:jc w:val="both"/><w:overflowPunct/>',
    });
    for (const run of paintedRuns(fixture)) expect(run.style.clipPath).toBe('');
  });
});

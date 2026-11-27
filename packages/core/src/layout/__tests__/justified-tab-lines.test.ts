// Justified lines (`w:jc w:val="both"`, CT_Jc, ECMA-376 §17.3.1.13) that hold tabs (`w:tab`,
// CT_Empty, §17.3.3.32) or start with spaces.
//
// A tab advances to a fixed stop, so the text before it cannot move when the line takes its
// slack. Only the spaces after the line's last tab stretch. Spaces before the first
// character of that text keep their advance, at the line start and directly after the tab.
// Text that a center, right or decimal stop (ST_TabJc, §17.18.84) places does not stretch.
import { describe, expect, test } from 'bun:test';
import { caretAt, selectionRects } from '../semantic-interaction.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { hitTestSemantic } from '../semantic-point-queries.ts';
import { linesOf, type LineRecord } from '../semantic-records.ts';
import { layoutUnderFloat, loadBody, squareWrapZone } from './float-over-table-harness.ts';

// 10pt per character at 11pt, a 300pt measure, and default tab stops every 36pt.
const measurer = createFixedMeasurer(10, 14);
const geometry = { width: 320, height: 400, margin: { top: 10, right: 10, bottom: 10, left: 10 } };
const MEASURE = 300;
const RPR = '<w:sz w:val="22"/>';
/** `text` as runs, with each `\t` as a `w:tab` run and each `\n` as a `w:br` run. */
const runs = (text: string, runProperties = '') =>
  text
    .split(/([\t\n])/)
    .map((part) =>
      part === '\t'
        ? '<w:r><w:tab/></w:r>'
        : part === '\n'
          ? '<w:r><w:br/></w:r>'
          : part
            ? `<w:r><w:rPr>${runProperties}${RPR}</w:rPr><w:t xml:space="preserve">${part}</w:t></w:r>`
            : ''
    )
    .join('');
const paragraph = (text: string, properties = '', jc = 'both', runProperties = '') =>
  `<w:p><w:pPr>${properties}<w:jc w:val="${jc}"/></w:pPr>${runs(text, runProperties)}</w:p>`;
const stop = (alignment: string, positionPt: number) =>
  `<w:tabs><w:tab w:val="${alignment}" w:pos="${positionPt * 20}"/></w:tabs>`;

function layout(body: string, compatibilityMode = 15) {
  return layoutSemanticDocument(loadBody(body), 0, { measurer, geometry, compatibilityMode });
}
function firstLine(body: string, compatibilityMode = 15): LineRecord {
  return linesOf(layout(body, compatibilityMode))[0] as LineRecord;
}
/** Each word of a line as `[word, start x]`. */
function words(line: LineRecord): (readonly [string, number])[] {
  return line.spans
    .filter((span) => span.text.trim() !== '')
    .map((span) => [span.text.trim(), Number(span.box.x.toFixed(4))] as const);
}
const x = (line: LineRecord, word: string) => words(line).find(([text]) => text === word)![1];

// The line holds `ab cd`, a tab to the 72pt stop, and seven words; the long word wraps.
const TAIL = 'ef gh ij kl mn op qr stuvwxyz end';

describe('a justified line with a tab', () => {
  for (const mode of [11, 12, 14, 15]) {
    test(`mode ${mode}: only the text after the tab stretches`, () => {
      const line = firstLine(paragraph(`ab cd\t${TAIL}`), mode);
      // The text before the tab keeps its natural spacing, and the tab keeps its stop.
      expect(x(line, 'ab')).toBe(0);
      expect(x(line, 'cd')).toBe(30);
      expect(x(line, 'ef')).toBe(72);
      // Seven words of 20pt from 72pt leave 88pt for six gaps.
      const gap = 88 / 6;
      expect(x(line, 'gh')).toBeCloseTo(72 + 20 + gap, 4);
      expect(x(line, 'qr') + 20).toBeCloseTo(MEASURE, 4);
    });
  }

  test('a space before the tab and the spaces after it keep their advance', () => {
    const before = firstLine(paragraph(`ab cd \t${TAIL}`));
    expect(x(before, 'cd')).toBe(30);
    expect(x(before, 'ef')).toBe(72);
    expect(x(before, 'qr') + 20).toBeCloseTo(MEASURE, 4);
    const after = firstLine(paragraph(`ab cd\t  ${TAIL}`));
    expect(x(after, 'cd')).toBe(30);
    expect(x(after, 'ef')).toBe(72 + 20);
    const last = words(after).at(-1)!;
    expect(last[1] + 10 * last[0].length).toBeCloseTo(MEASURE, 4);
  });

  test('the text between two tabs keeps its natural spacing', () => {
    const line = firstLine(paragraph(`ab cd\tef gh\t${TAIL.slice(6)}`));
    expect(words(line).slice(0, 5)).toEqual([
      ['ab', 0],
      ['cd', 30],
      ['ef', 72],
      ['gh', 102],
      ['ij', 144],
    ]);
    expect(x(line, 'qr') + 20).toBeCloseTo(MEASURE, 4);
    expect(x(line, 'kl') - x(line, 'ij')).toBeGreaterThan(30);
  });

  test('a line with one word after its last tab keeps its natural spacing', () => {
    // The 23-character word cannot share the line, so `ef` is the only text after the tab.
    const body = (jc: string) => paragraph(`ab cd\tef ${'x'.repeat(23)} end`, '', jc);
    expect(words(firstLine(body('both')))).toEqual(words(firstLine(body('left'))));
  });

  for (const alignment of ['center', 'right', 'decimal']) {
    test(`text that a ${alignment} stop places does not stretch`, () => {
      // A manual line break ends the line, so the text after the tab fits at its stop.
      const body = (jc: string) => paragraph('ab cd\tef 1.5 gh\nend', stop(alignment, 200), jc);
      const line = firstLine(body('both'));
      expect(line.spans.find((span) => span.text === '\t')!.box.width).toBeGreaterThan(0);
      expect(words(line)).toEqual(words(firstLine(body('left'))));
    });
  }

  test('right-to-left text that a decimal stop places does not stretch', () => {
    const rtl = (jc: string) =>
      paragraph('אב גד\tהו 1.5 זח\nסוף', `<w:bidi/>${stop('decimal', 200)}`, jc, '<w:rtl/>');
    const widths = (line: LineRecord) => line.spans.map((span) => span.box.width);
    expect(widths(firstLine(rtl('both')))).toEqual(widths(firstLine(rtl('left'))));
  });

  test('text on a wrapped line stretches after a center stop that keeps some width', () => {
    const line = firstLine(paragraph(`ab\t${TAIL}`, stop('center', 200)));
    expect(line.spans.find((span) => span.text === '\t')!.box.width).toBeGreaterThan(0);
    expect(x(line, 'ab')).toBe(0);
    const last = words(line).at(-1)!;
    expect(last[1] + 10 * last[0].length).toBeCloseTo(MEASURE, 4);
  });

  for (const alignment of ['center', 'right']) {
    test(`text too long for a ${alignment} stop stretches after the tab`, () => {
      const line = firstLine(paragraph(`ab cd\t${TAIL}`, stop(alignment, 60)));
      expect(line.spans.find((span) => span.text === '\t')!.box.width).toBe(0);
      expect(x(line, 'cd')).toBe(30);
      expect(x(line, 'ef')).toBe(50);
      const last = words(line).at(-1)!;
      expect(last[1] + 10 * last[0].length).toBeCloseTo(MEASURE, 4);
    });
  }

  test('text that runs on after a decimal stop to a wrapped line end stretches', () => {
    // The number sits at the stop; the line wraps, so the text after the number is plain text.
    const body = (jc: string) => paragraph(`ab\t1.5 ${TAIL}`, stop('decimal', 60), jc);
    const line = firstLine(body('both'));
    const natural = firstLine(body('left'));
    expect(x(line, 'ab')).toBe(0);
    expect(x(line, '1.5')).toBe(x(natural, '1.5'));
    const last = words(line).at(-1)!;
    expect(last[1] + 10 * last[0].length).toBeCloseTo(MEASURE, 4);
  });

  test('a line in a table cell follows the same rule', () => {
    const cell =
      '<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
      '</w:tblPr><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid><w:tr><w:tc>' +
      `<w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr>${paragraph(`ab cd\t${TAIL}`)}` +
      '</w:tc></w:tr></w:tbl><w:p/>';
    const line = firstLine(cell);
    expect(x(line, 'cd') - x(line, 'ab')).toBe(30);
    expect(x(line, 'ef') - x(line, 'ab')).toBe(72);
    expect(x(line, 'gh') - x(line, 'ef')).toBeGreaterThan(30);
  });

  test('East Asian text after the tab keeps the spaces directly after the tab', () => {
    const line = firstLine(paragraph('ab\t  cd ef 漢字 gh ij kl mn op stuvwxyzabc'));
    const spaces = line.spans.filter((span) => span.text === ' ');
    expect(spaces.slice(0, 2).map((span) => span.box.x)).toEqual([36, 46]);
    expect(x(line, 'cd')).toBe(56);
    expect(x(line, 'ab')).toBe(0);
    const last = words(line).at(-1)!;
    expect(last[1] + 10 * last[0].length).toBeCloseTo(MEASURE, 4);
  });

  test('a right-to-left line stretches only the text after its tab', () => {
    const rtl = (jc: string) =>
      paragraph('אב גד\tהו זח טי כל מנ סע פצ קרשתאבגד הו', '<w:bidi/>', jc, '<w:rtl/>');
    const line = firstLine(rtl('both'));
    // `left` is the leading edge, the right one in a right-to-left paragraph.
    const natural = firstLine(rtl('left'));
    // The line starts at the right edge: the first two words and the stop keep their places.
    expect(x(line, 'אב')).toBe(x(natural, 'אב'));
    expect(x(line, 'גד')).toBe(x(natural, 'גד'));
    const tab = line.spans.find((span) => span.text === '\t')!;
    expect(tab.box.x).toBeCloseTo(MEASURE - 72, 4);
    // The text after the tab reaches the left edge.
    expect(Math.min(...words(line).map(([, start]) => start))).toBeCloseTo(0, 4);
    expect(x(line, 'הו') - x(line, 'זח')).toBeGreaterThan(x(natural, 'הו') - x(natural, 'זח'));
  });
});

describe('a justified line that starts with spaces', () => {
  // Each tail leaves the long word no room on the first line, also with compressed spaces.
  for (const [count, tail] of [
    [1, TAIL],
    [3, TAIL],
    [8, 'ef gh ij kl mn stuvwxyz end'],
  ] as const) {
    test(`${count} leading spaces keep their advance`, () => {
      const line = firstLine(paragraph(`${' '.repeat(count)}ab ${tail}`));
      expect(x(line, 'ab')).toBe(10 * count);
      const last = words(line).at(-1)!;
      expect(last[1] + 10 * last[0].length).toBeCloseTo(MEASURE, 4);
    });
  }

  test('leading spaces keep their advance before East Asian text', () => {
    const line = firstLine(paragraph('   ab cd 漢字 ef gh ij stuvwxyzabcdefgh end'));
    expect(x(line, 'ab')).toBe(30);
    expect(x(line, 'ij') + 20).toBeCloseTo(MEASURE, 4);
  });

  test('leading spaces of a right-to-left line keep their advance', () => {
    const rtl = (jc: string) =>
      paragraph('   אב גד הו זח טי כל מנ סע פצ קרשתאבגד הו', '<w:bidi/>', jc, '<w:rtl/>');
    const line = firstLine(rtl('both'));
    // The first word ends three spaces from the right edge, and the last word is at the left.
    const first = line.spans.find((span) => span.text.trim() === 'אב')!;
    const natural = firstLine(rtl('left')).spans.find((span) => span.text.trim() === 'אב')!;
    expect(first.box.x + first.box.width).toBeCloseTo(natural.box.x + natural.box.width, 4);
    expect(first.box.width).toBeGreaterThan(natural.box.width);
    expect(Math.min(...words(line).map(([, start]) => start))).toBeCloseTo(0, 4);
  });

  test('leading spaces keep their advance with a first-line or a hanging indent', () => {
    for (const properties of [
      '<w:ind w:firstLine="400"/>',
      '<w:ind w:left="720" w:hanging="360"/>',
    ]) {
      const body = (jc: string) => paragraph(`   ab ${TAIL}`, properties, jc);
      const line = firstLine(body('both'));
      expect(x(line, 'ab')).toBe(x(firstLine(body('left')), 'ab'));
      expect(x(line, 'ef') - x(line, 'ab')).toBeGreaterThan(30);
    }
  });

  test('leading spaces keep their advance before a manual line break', () => {
    const line = firstLine(paragraph(`   ab cd ef\n${TAIL}`));
    expect(x(line, 'ab')).toBe(30);
  });
});

describe('a justified line beside a wrapping object', () => {
  // The object covers 120pt to 170pt of the 300pt measure; this harness sets 6pt characters.
  function besideFloat(body: string): LineRecord {
    const part = loadBody(`${body}<w:p/>`);
    const id = linesOf(layoutUnderFloat(part, new Map(), geometry))[0]!.range.paragraphId;
    const zone = squareWrapZone({
      anchorParagraphId: id,
      top: 0,
      height: 60,
      left: 120,
      width: 50,
      contentWidth: MEASURE,
    });
    return linesOf(layoutUnderFloat(part, new Map([[0, [zone]]]), geometry))[0] as LineRecord;
  }
  const LONG = 'ef gh ij kl mn op qr st uv wx yz ab cd ef gh ij';

  test('the text before a tab in the first passage keeps its natural spacing', () => {
    const line = besideFloat(paragraph(`ab cd\t${LONG}`));
    const natural = besideFloat(paragraph(`ab cd\t${LONG}`, '', 'left'));
    expect(words(line).slice(0, 3)).toEqual(words(natural).slice(0, 3));
    // The passage after the object stretches to the measure.
    const last = line.spans.filter((span) => span.text.trim() !== '').at(-1)!;
    expect(last.box.x + 12).toBeCloseTo(MEASURE, 4);
  });

  test('a right-to-left distributed line there sets as a justified line', () => {
    // Each passage of such a line stretches its spaces only, so the leading-space rule holds.
    const rtl = (jc: string) =>
      paragraph(
        ' אב גד הו זח טי כל מנ סע פצ קר שת אב גד הו זח טי כל מנ',
        '<w:bidi/>',
        jc,
        '<w:rtl/>'
      );
    const line = besideFloat(rtl('distribute'));
    const natural = besideFloat(rtl('left'));
    expect(line.spans[0]!.text).toBe(' ');
    expect(line.spans[0]!.box.width).toBeCloseTo(natural.spans[0]!.box.width, 4);
    expect(line.spans[0]!.box.x + line.spans[0]!.box.width).toBeCloseTo(MEASURE, 4);
  });
});

describe('controls', () => {
  test('a justified line without a tab stretches every space', () => {
    const line = firstLine(paragraph(`ab cd ${TAIL}`));
    const starts = words(line).map(([, start]) => start);
    const gaps = starts.slice(1).map((start, index) => start - starts[index]!);
    expect(starts[0]).toBe(0);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]!, 4);
    expect(gaps[0]).toBeGreaterThan(30);
    expect(starts.at(-1)! + 20).toBeCloseTo(MEASURE, 4);
  });

  test('the last line of a justified paragraph keeps its natural spacing', () => {
    expect(words(firstLine(paragraph('ab cd\tef gh')))).toEqual([
      ['ab', 0],
      ['cd', 30],
      ['ef', 72],
      ['gh', 102],
    ]);
  });
});

describe('caret, hit test and selection on a justified line with a tab', () => {
  const result = layout(paragraph(`ab cd\t  ${TAIL}`));
  const line = linesOf(result)[0] as LineRecord;
  const paragraphId = line.range.paragraphId;
  const caretX = (offset: number) => caretAt(result, { paragraphId, offset }, measurer)!.x;

  test('the caret at each span start sits at the laid-out span', () => {
    for (const span of line.spans) {
      if (span.range.start === line.range.end) continue;
      expect(caretX(span.range.start)).toBeCloseTo(line.box.x + span.box.x, 4);
    }
    // Inside a word after the tab the caret follows the glyphs, not the natural positions.
    const word = line.spans.find((span) => span.text === 'kl ')!;
    expect(caretX(word.range.start + 1)).toBeCloseTo(line.box.x + word.box.x + 10, 4);
  });

  test('a point on a word maps back to that word', () => {
    for (const span of line.spans) {
      if (span.text.trim() === '') continue;
      const hit = hitTestSemantic(result, { x: line.box.x + span.box.x + 4, y: line.box.y + 5 })!;
      expect(hit.position).toEqual({ paragraphId, offset: span.range.start });
      expect(hit.x).toBeCloseTo(line.box.x + span.box.x, 4);
    }
  });

  test('a selection covers the laid-out words', () => {
    const from = line.spans.find((span) => span.text === 'cd')!;
    const to = line.spans.find((span) => span.text === 'ij ')!;
    const rects = selectionRects(
      result,
      {
        anchor: { paragraphId, offset: from.range.start },
        head: { paragraphId, offset: to.range.start + 2 },
      },
      [paragraphId],
      measurer
    );
    expect(rects).toHaveLength(1);
    expect(rects[0]!.x).toBeCloseTo(line.box.x + from.box.x, 4);
    expect(rects[0]!.x + rects[0]!.width).toBeCloseTo(line.box.x + to.box.x + 20, 4);
  });
});

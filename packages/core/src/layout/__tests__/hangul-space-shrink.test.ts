// A justified or distributed line in a modern compatibility mode shrinks its inter-word spaces
// to keep one more word. A space beside Hangul shrinks with the others, by the same amount,
// unless the document balances single-byte and double-byte widths
// (`w:balanceSingleByteDoubleByteWidth`). With that setting, a space with a Hangul syllable on
// either side keeps its natural advance, and only the line's other spaces shrink. The line
// without the word still stretches every space, those beside Hangul too.
import { expect, test } from 'bun:test';
import { loadBody } from './float-over-table-harness.ts';
import { readOoxmlPart } from '../../store/index.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import type { TextMeasurer } from '../semantic-records.ts';
import { anyShrunk, shrunkBy } from './shrunk-space.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// Every character is 10 pt and a space is 4 pt, so a space can give up 1 pt.
const measurer: TextMeasurer = {
  measure: (text) => [...text].reduce((n, c) => n + (c === ' ' ? 4 : 10), 0),
  lineMetrics: () => ({ height: 14, baseline: 11 }),
};
function part(name: string, xml: string) {
  const read = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!read.ok) throw Error(read.reason);
  return read.part;
}
const cascade = (balanced: boolean) =>
  buildStyleCascadeTable(
    part('/word/styles.xml', `<w:styles xmlns:w="${W}"/>`).root,
    undefined,
    part(
      '/word/settings.xml',
      `<w:settings xmlns:w="${W}"><w:compat>` +
        (balanced ? '<w:balanceSingleByteDoubleByteWidth/>' : '') +
        '<w:compatSetting w:name="compatibilityMode" ' +
        'w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
    ).root
  );
// Batang at 11 pt; the measurer gives every face the same advances.
const run = (text: string) =>
  '<w:r><w:rPr><w:rFonts w:ascii="Batang" w:hAnsi="Batang" w:eastAsia="Batang"/>' +
  `<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
/** One paragraph of `runs` on a `width` pt measure; `balanced` writes the setting. */
const layout = (runs: string | readonly string[], width: number, balanced = true, jc = 'both') =>
  layoutSemanticDocument(
    loadBody(
      `<w:p><w:pPr><w:jc w:val="${jc}"/></w:pPr>${[runs].flat().map(run).join('')}</w:p>` +
        `<w:sectPr><w:pgSz w:w="${(width + 50) * 20}" w:h="6000"/>` +
        '<w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>'
    ),
    1,
    { measurer, compatibilityMode: 15, styleCascade: cascade(balanced) }
  );
const content = (result: ReturnType<typeof layout>) =>
  linesOf(result).map((line) =>
    line.spans
      .map((span) => span.text)
      .join('')
      .trimEnd()
  );
/** How far the space in front of `word` shrank on the first line, whichever span holds it. */
const shrunkBefore = (result: ReturnType<typeof layout>, word: string) => {
  const spans = linesOf(result)[0]!.spans;
  return shrunkBy(
    spans,
    spans.findIndex((span, index) => span.text.endsWith(' ') && spans[index + 1]?.text === word)
  );
};

test('without balanced widths, spaces beside Hangul shrink by the same amount as the others', () => {
  // `가가 나나 다다` is 2 pt too wide, and its two spaces give up 1 pt each.
  const korean = layout('가가 나나 다다 라라', 66, false);
  expect(content(korean)).toEqual(['가가 나나 다다', '라라']);
  expect(shrunkBefore(korean, '나나')).toBeCloseTo(1, 6);
  expect(shrunkBefore(korean, '다다')).toBeCloseTo(1, 6);
  // `aa bb 가가 나나 cc` is 2 pt too wide: four spaces, one between Latin words, give 0.5 pt each.
  const mixed = layout('aa bb 가가 나나 cc', 114, false);
  expect(content(mixed)).toEqual(['aa bb 가가 나나 cc']);
  for (const word of ['bb', '가가', '나나', 'cc'])
    expect(shrunkBefore(mixed, word)).toBeCloseTo(0.5, 6);
});

test('with balanced widths, spaces between Hangul words keep their advance', () => {
  // The same line: its two spaces could lend exactly the 2 pt, but they keep their width.
  const result = layout('가가 나나 다다 라라', 66);
  expect(content(result)).toEqual(['가가 나나', '다다 라라']);
  expect(anyShrunk(linesOf(result)[0]!.spans)).toBe(false);
  // Only the Latin space of the mixed line lends, 1 pt.
  expect(content(layout('aa bb 가가 나나 cc', 114))).toEqual(['aa bb 가가 나나', 'cc']);
});

test('with balanced widths, a space run between Hangul runs keeps its advance', () => {
  const runs = ['가가', ' ', '나나', ' ', '다다', ' ', '라라'];
  expect(content(layout(runs, 66))).toEqual(['가가 나나', '다다 라라']);
  expect(content(layout(runs, 66, false))).toEqual(['가가 나나 다다', '라라']);
});

test('with balanced widths, a distributed line keeps the spaces beside Hangul too', () => {
  expect(content(layout('가가 나나 다다 라라', 66, true, 'distribute'))).toEqual([
    '가가 나나',
    '다다 라라',
  ]);
  expect(content(layout('가가 나나 다다 라라', 66, false, 'distribute'))).toEqual([
    '가가 나나 다다',
    '라라',
  ]);
});

test('with balanced widths, Latin spaces on a line with Hangul shrink alone', () => {
  // `aa bb cc 가가` is 1 pt too wide: the two Latin spaces give up 0.5 pt each.
  const result = layout('aa bb cc 가가 dd', 91);
  expect(content(result)).toEqual(['aa bb cc 가가', 'dd']);
  expect(shrunkBefore(result, 'bb')).toBeCloseTo(0.5, 6);
  expect(shrunkBefore(result, 'cc')).toBeCloseTo(0.5, 6);
  expect(shrunkBefore(result, '가가')).toBeCloseTo(0, 6);
});

test('with balanced widths, the space before a Hangul word still hangs after the shorter line', () => {
  // `aa bb 가가` is 2 pt too wide; only the space after `aa` can lend, 1 pt.
  expect(content(layout('aa bb 가가 dd', 66))).toEqual(['aa bb', '가가 dd']);
  // Ten `a` words and `가가` are 7 pt too wide, and nine Latin spaces lend 9 pt. Without the
  // word, the space before `가가` hangs, so the shorter line stretches its nine spaces by 17 pt:
  // more than twice the shrink.
  expect(content(layout('a a a a a a a a a a 가가 b', 153))[0]).toBe('a a a a a a a a a a 가가');
});

test('with balanced widths, the shorter line stretches the spaces beside Hangul too', () => {
  // `a a a 가 가 가 가 가 가 가 b` is 1.5 pt too wide, and the two Latin spaces lend it at
  // 0.19 pt per point of space. Without `b`, the line stretches its nine spaces by 12.5 pt,
  // 0.35 pt per point: less than twice the shrink, so `b` wraps. Counting only the two Latin
  // spaces, the stretch would be 1.56 pt per point, and `b` would stay.
  const text = 'a a a 가 가 가 가 가 가 가 b';
  expect(content(layout(text, 148.5))).toEqual(['a a a 가 가 가 가 가 가 가', 'b']);
  // Without the setting, all ten spaces lend, and `b` stays.
  expect(content(layout(text, 148.5, false))).toEqual([text]);
});

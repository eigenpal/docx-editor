// A justified line in a modern compatibility mode shrinks its inter-word spaces to keep one more
// word, but Word keeps a space beside Hangul at its natural advance. In one justified line of
// Korean and English words, the spaces between Latin words shrink while every space with a
// Hangul syllable on either side keeps its width.
import { expect, test } from 'bun:test';
import { loadBody } from './float-over-table-harness.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import type { TextMeasurer } from '../semantic-records.ts';
import { anyShrunk, shrunkBy } from './shrunk-space.ts';

// Every character is 10 pt and a space is 4 pt, so a space can give up 1 pt.
const measurer: TextMeasurer = {
  measure: (text) => [...text].reduce((n, c) => n + (c === ' ' ? 4 : 10), 0),
  lineMetrics: () => ({ height: 14, baseline: 11 }),
};
const layout = (text: string, width: number) =>
  layoutSemanticDocument(
    loadBody(
      `<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="${(width + 50) * 20}" w:h="6000"/><w:pgMar w:left="500" w:right="500" w:top="500" w:bottom="500"/></w:sectPr>`
    ),
    1,
    { measurer, compatibilityMode: 15 }
  );
const content = (result: ReturnType<typeof layout>) =>
  linesOf(result).map((line) =>
    line.spans
      .map((span) => span.text)
      .join('')
      .trimEnd()
  );

test('spaces between Hangul words keep their advance, so the overflowing word wraps', () => {
  // `가가 나나 다다` is 2 pt too wide; its two spaces could lend exactly that.
  const result = layout('가가 나나 다다 라라', 66);
  expect(content(result)).toEqual(['가가 나나', '다다 라라']);
  expect(anyShrunk(linesOf(result)[0]!.spans)).toBe(false);
});

test('the space before a Hangul word lends nothing, and still hangs after the shorter line', () => {
  // `aa bb 가가` is 2 pt too wide; only the space after `aa` can lend, 1 pt.
  expect(content(layout('aa bb 가가 dd', 66))).toEqual(['aa bb', '가가 dd']);
  // Ten `a` words and `가가` are 7 pt too wide, and nine Latin spaces lend 9 pt. Without the
  // word, the space before `가가` hangs, so the shorter line stretches its nine spaces by 17 pt:
  // more than twice the shrink.
  expect(content(layout('a a a a a a a a a a 가가 b', 153))[0]).toBe('a a a a a a a a a a 가가');
});

test('Latin spaces on a line with Hangul shrink, and the space beside Hangul keeps its width', () => {
  // `aa bb cc 가가` is 1 pt too wide: the two Latin spaces give up 0.5 pt each.
  const result = layout('aa bb cc 가가 dd', 91);
  expect(content(result)).toEqual(['aa bb cc 가가', 'dd']);
  const spans = linesOf(result)[0]!.spans;
  // How far the space in front of `word` shrank, whichever span holds it.
  const before = (word: string) =>
    shrunkBy(
      spans,
      spans.findIndex((span, index) => span.text.endsWith(' ') && spans[index + 1]?.text === word)
    );
  expect(before('bb')).toBeCloseTo(0.5, 6);
  expect(before('cc')).toBeCloseTo(0.5, 6);
  expect(before('가가')).toBeCloseTo(0, 6);
});

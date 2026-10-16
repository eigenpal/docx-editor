// A space that a zero-width space follows hangs at the line end in alignment too (#1384).
//
// Line breaking hangs "space + U+200B" like a plain space. Right, centered, justified, and
// right-to-left justified lines must place their ink exactly where the same line with a plain
// space puts it. The measurer gives U+200B no width, as a shaped font does.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { caretBoxOnLine, layoutSemanticDocument, type SemanticLayout } from '../index.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import type { TextMeasurer } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const fixed = createFixedMeasurer(6, 14);
const measurer: TextMeasurer = {
  ...fixed,
  measure: (text, style) => fixed.measure(text.replace(/​/gu, ''), style),
};
/** 1500 twips less two 200-twip margins: a 55pt measure. */
const MEASURE = 55;

function document(jc: string, text: string, rtl = false): OoxmlPart {
  const pPr = `<w:pPr>${rtl ? '<w:bidi/>' : ''}<w:jc w:val="${jc}"/></w:pPr>`;
  const rPr = `<w:rPr>${rtl ? '<w:rtl/>' : ''}<w:sz w:val="22"/></w:rPr>`;
  // `~` separates runs.
  const runs = text
    .split('~')
    .map((part) => `<w:r>${rPr}<w:t xml:space="preserve">${part}</w:t></w:r>`)
    .join('');
  const body =
    `<w:p>${pPr}${runs}</w:p>` +
    '<w:sectPr><w:pgSz w:w="1500" w:h="20000"/>' +
    '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/></w:sectPr>';
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** Each line's spans as [text without U+200B, x, width], rounded to a hundredth. */
const geometry = (layout: SemanticLayout) =>
  layout.pages.flatMap((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.map((line) =>
            line.spans.map((span) => [
              span.text.replace(/​/gu, ''),
              Math.round(span.box.x * 100) / 100,
              Math.round(span.box.width * 100) / 100,
            ])
          )
        : []
    )
  );

const lay = (jc: string, text: string, rtl = false) =>
  geometry(layoutSemanticDocument(document(jc, text, rtl), 1, { measurer }));

const CASES: [string, string][] = [
  ['aaaa ​bbbbbbbbb', 'aaaa bbbbbbbbb'],
  ['aa ​bb ​cc ​dddddddd', 'aa bb cc dddddddd'],
  ['aaaa ​bbbb ​cccc', 'aaaa bbbb cccc'],
  ['ฉันอยาก ​กินข้าว', 'ฉันอยาก กินข้าว'],
];

describe('a space before a zero-width space hangs in alignment', () => {
  for (const jc of ['right', 'center', 'both']) {
    test(`${jc}: the same geometry as a plain space`, () => {
      for (const [spaced, plain] of CASES) expect(lay(jc, spaced)).toEqual(lay(jc, plain));
    });
  }

  test('right: the ink of a line ending in a space and a zero-width space ends at the measure', () => {
    const [first] = geometry(
      layoutSemanticDocument(document('right', 'aaaa ​bbbbbbbbb'), 1, { measurer })
    );
    const [text, x] = first![0]! as [string, number, number];
    expect(text).toBe('aaaa ');
    expect(x + 24).toBeCloseTo(MEASURE, 5);
  });

  test('right-to-left justified text matches a plain space', () => {
    for (const [spaced, plain] of [
      ['אאאא ​בבבב ​גגגג', 'אאאא בבבב גגגג'],
      ['אא ​בב ​גג ​דדדדדדדד', 'אא בב גג דדדדדדדד'],
    ] as const) {
      expect(lay('both', spaced, true)).toEqual(lay('both', plain, true));
      expect(lay('left', spaced, true)).toEqual(lay('left', plain, true));
    }
  });

  test('on a justified line the caret after a stretched space is at its painted end', () => {
    const carets = (text: string) => {
      const layout = layoutSemanticDocument(document('both', text), 1, { measurer });
      const fragment = layout.pages[0]!.fragments.find((entry) => entry.kind === 'paragraph');
      if (fragment?.kind !== 'paragraph') throw new Error('no paragraph');
      const line = fragment.lines[0]!;
      const out: number[] = [];
      for (let offset = line.range.start; offset <= line.range.end; offset++)
        out.push(Math.round(caretBoxOnLine(line, offset, measurer)!.x * 10) / 10);
      return out;
    };
    // The zero-width space in the same run as the space, or in a run of its own: offset 3
    // (between the space and the zero-width space) and offset 4 are one visible position.
    const together = carets('aa \u200b~bb \u200b~cc \u200b~dd \u200b~eeeeeeee');
    const apart = carets('aa ~\u200b~bb ~\u200b~cc ~\u200b~dd ~\u200b~eeeeeeee');
    expect(together).toEqual(apart);
    expect(together[3]).toBeCloseTo(together[4]!, 5);
    expect(together[3]).toBeGreaterThan(18.5);
  });
});

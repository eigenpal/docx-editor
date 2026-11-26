// A tab stays with the unbreakable word after it (`w:tab`, Tab Character, `CT_Empty`, ECMA-376
// Part 1, 17.3.3.32). When the word would overflow the line, the tab opens the next line and
// reaches its stop there. At a left stop the word starts at the stop and breaks at the edge. At
// an aligned stop the tab moves only when the word fits after it.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf } from '../semantic-records.ts';
import { elevenPointDefaults } from './fixtures/eleven-point-defaults.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NBSP = ' ';
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const tab = '<w:r><w:tab/></w:r>';

/** One paragraph 400pt wide, 6pt per character; default stops every 36pt. */
function layout(content: string, pPr = '', compatibilityMode = 15) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${pPr}</w:pPr>${content}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return linesOf(
    layoutSemanticDocument(read.part, 1, {
      measurer: createFixedMeasurer(6, 12),
      styleCascade: elevenPointDefaults(),
      compatibilityMode,
      geometry: { width: 400, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
    })
  );
}

const texts = (lines: ReturnType<typeof layout>) =>
  lines.map((line) => line.spans.map((span) => span.text).join(''));

test('a tab whose word overflows the line opens the next line with it', () => {
  // 378pt of text, then a tab to the 396pt stop: the 48pt word cannot follow it there.
  const lines = layout(run('A'.repeat(63)) + tab + run('Longword'));

  expect(texts(lines)).toEqual(['A'.repeat(63), '\tLongword']);
  const word = lines[1]!.spans.find((span) => span.text === 'Longword')!;
  expect(word.box.x).toBeCloseTo(36, 5);
});

test('a tab before no-break spaces carries them to its stop on the next line', () => {
  // The letterhead shape: text past a centre stop, a tab to the right stop, a second tab, then
  // no-break spaces and a website. The spaces cannot hang, so the second tab moves down and
  // centres them with the website on the 200pt stop.
  const stops =
    '<w:tabs><w:tab w:val="center" w:pos="4000"/><w:tab w:val="right" w:pos="7600"/></w:tabs>';
  const lines = layout(run('B'.repeat(35)) + tab + tab + run(`${NBSP.repeat(10)} site`), stops);

  expect(lines).toHaveLength(2);
  expect(lines[1]!.spans[0]!.text).toBe('\t');
  // The 15-character segment (90pt) centres on 200pt, so it starts at 155pt.
  const site = lines[1]!.spans.find((span) => span.text.includes('site'))!;
  expect(site.box.x + site.box.width).toBeCloseTo(245, 5);
});

test('a word wider than a line moves down with its tab and breaks after the stop', () => {
  // The 480pt word fits no line. The tab still opens the next line and reaches the 36pt stop,
  // and the word breaks there instead of opening the line at the margin.
  const lines = layout(run('Text') + tab + run('L'.repeat(80)));

  expect(texts(lines)).toEqual(['Text', `\t${'L'.repeat(60)}`, 'L'.repeat(20)]);
  const word = lines[1]!.spans.find((span) => span.text.startsWith('L'))!;
  expect(word.box.x).toBeCloseTo(36, 5);
});

test('a second leading tab moves down with a word wider than the rest of a fresh line', () => {
  // Two tabs reach 72pt. After one tab on a fresh line the 420pt word still overflows, so the
  // first line keeps only the first tab and the word breaks after the second tab.
  const lines = layout(tab + tab + run('L'.repeat(70)));

  expect(texts(lines)).toEqual(['\t', `\t${'L'.repeat(60)}`, 'L'.repeat(10)]);
});

test('a word after a custom stop near the right edge moves down with its tab and breaks there', () => {
  // A custom stop at 392pt leaves room for one 6pt character before the 400pt edge, on this
  // line and on a fresh line. The tab moves down, and the word breaks after its first character.
  const lines = layout(
    run('Text') + tab + run('12'),
    '<w:tabs><w:tab w:val="left" w:pos="7840"/></w:tabs>'
  );

  expect(texts(lines)).toEqual(['Text', '\t1', '2']);
});

test('a word moves past a tab whose stop leaves no room for one character', () => {
  // A custom stop at 396pt leaves 4pt: the moved tab ends its line alone and the word opens
  // the next line at the margin.
  const lines = layout(
    run('Text') + tab + run('12'),
    '<w:tabs><w:tab w:val="left" w:pos="7920"/></w:tabs>'
  );

  expect(texts(lines)).toEqual(['Text', '\t', '12']);
});

test('an aligned stop keeps its tab when the word fits no line after it', () => {
  // A right stop aligns the whole word, so a word wider than a line does not move the tab.
  const lines = layout(
    run('Text') + tab + run('L'.repeat(80)),
    '<w:tabs><w:tab w:val="right" w:pos="7200"/></w:tabs>'
  );

  expect(texts(lines)[0]).toBe('Text\t');
  expect(lines[1]!.spans[0]!.box.x).toBeCloseTo(0, 5);
});

test('a custom left stop after the right indent keeps its tab up to the margin', () => {
  // The indent edge is 350pt. Text after a stop at 380pt or at the 400pt margin runs to the
  // margin, so the tab does not move down with the 60pt word. A stop past the margin does.
  const at = (pos: number) =>
    texts(
      layout(
        run('Text') + tab + run('L'.repeat(10)),
        `<w:tabs><w:tab w:val="left" w:pos="${pos}"/></w:tabs><w:ind w:right="1000"/>`
      )
    );

  expect(at(7600)).toEqual(['Text\t', 'L'.repeat(10)]);
  expect(at(8000)).toEqual(['Text\t', 'L'.repeat(10)]);
  expect(at(8500)).toEqual(['Text', '\t', 'L'.repeat(10)]);
});

test('a right stop after the right indent keeps its tab when the word fits before the margin', () => {
  // A contents line: the indent edge is 350pt and the right stop at 380pt lies between it and
  // the 400pt margin. Text after an aligned stop may run past the indent to the stop, so the page
  // number fits after its tab, and the tab does not move down to the 72pt stop.
  const stops =
    '<w:tabs><w:tab w:val="left" w:pos="1440"/><w:tab w:val="right" w:leader="dot" w:pos="7600"/></w:tabs>';
  const lines = layout(
    run('1.') + tab + run('T'.repeat(38)) + tab + run('12'),
    `${stops}<w:ind w:right="1000"/>`
  );

  expect(texts(lines)).toEqual([`1.\t${'T'.repeat(38)}\t12`]);
  const page = lines[0]!.spans.find((span) => span.text === '12')!;
  expect(page.box.x + page.box.width).toBeCloseTo(380, 5);
});

test('a right stop after the right indent moves its tab with a word that fits there on a fresh line', () => {
  // 342pt of text leaves 8pt before the 350pt indent edge. The 42pt word ends at the 380pt stop
  // on a fresh line, past the indent, so the tab moves down with it instead of staying alone.
  const lines = layout(
    run('A'.repeat(57)) + tab + run('1234567'),
    '<w:tabs><w:tab w:val="right" w:pos="7600"/></w:tabs><w:ind w:right="1000"/>'
  );

  expect(texts(lines)).toEqual(['A'.repeat(57), '\t1234567']);
  const word = lines[1]!.spans.find((span) => span.text === '1234567')!;
  expect(word.box.x + word.box.width).toBeCloseTo(380, 5);
});

test('a stop at the right edge keeps its tab only in a legacy document', () => {
  // In mode 15 the moved tab ends its line alone. A legacy document keeps the tab on the line,
  // because text after a stop at the edge may run past it.
  const content = run('Text') + tab + run('L'.repeat(10));
  const stop = '<w:tabs><w:tab w:val="left" w:pos="8000"/></w:tabs>';

  expect(texts(layout(content, stop))).toEqual(['Text', '\t', 'L'.repeat(10)]);
  expect(texts(layout(content, stop, 14))[0]).toBe('Text\t');
});

test('a decimal stop moves its tab only when the word fits after it on the next line', () => {
  const stop = '<w:tabs><w:tab w:val="decimal" w:pos="6000"/></w:tabs>';

  expect(texts(layout(run('Text') + tab + run('L'.repeat(80)), stop))[0]).toBe('Text\t');
  expect(texts(layout(run('A'.repeat(60)) + tab + run('L'.repeat(20)), stop))).toEqual([
    'A'.repeat(60),
    `\t${'L'.repeat(20)}`,
  ]);
});

test('in a legacy document a custom left stop past the right indent keeps its tab', () => {
  const lines = layout(
    run('Text') + tab + run('L'.repeat(10)),
    '<w:tabs><w:tab w:val="left" w:pos="7600"/></w:tabs><w:ind w:right="1000"/>',
    14
  );

  expect(texts(lines)).toEqual([`Text\t${'L'.repeat(10)}`]);
});

test('a word that ends in a page field keeps the tab when the word fits no line after it', () => {
  // The page number cannot be cut, so the word cannot break after the stop on a fresh line.
  const lines = layout(
    run('Text') +
      tab +
      run('L'.repeat(60)) +
      '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>'
  );

  expect(texts(lines)).toEqual(['Text\t', `${'L'.repeat(60)}1`]);
});

test('a word too wide before its optional hyphen moves down with its tab', () => {
  // The 426pt word, up to the optional hyphen, fits no line. The tab still moves down.
  const lines = layout(
    run('Text') + tab + run('L'.repeat(70)) + '<w:r><w:softHyphen/></w:r>' + run('M'.repeat(10))
  );

  expect(texts(lines)[0]).toBe('Text');
  expect(texts(lines)[1]).toBe(`\t${'L'.repeat(60)}`);
});

test('a page field after the word, past its dash, does not keep the tab', () => {
  // The word ends at the dash, so the page number after it does not stop the break after the stop.
  const lines = layout(
    run('Text') +
      tab +
      run(`${'L'.repeat(70)}-MM`) +
      '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>'
  );

  expect(texts(lines)[0]).toBe('Text');
  expect(texts(lines)[1]).toBe(`\t${'L'.repeat(60)}`);
});

test('a tab inside a field result keeps its line when the word fits no line after it', () => {
  // A tab in a field result cannot let the word after it be chopped after the stop.
  const field = (inner: string) =>
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> REF x </w:instrText></w:r>' +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${inner}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const lines = layout(run('Text') + field(tab + run('L'.repeat(80))));

  expect(texts(lines)[0]).toBe('Text\t');
});

test('a check box in the word keeps the tab when the word fits no line after it', () => {
  const box =
    '<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:checkBox><w:sizeAuto/></w:checkBox>' +
    '</w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMCHECKBOX </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const lines = layout(run('Text') + tab + run('L'.repeat(70)) + box);

  expect(texts(lines)[0]).toBe('Text\t');
});

test('in a table cell a word wider than the cell moves down with its tab', () => {
  const cell =
    '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0"/>' +
    '<w:right w:w="0"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
    '<w:tr><w:tc><w:tcPr><w:tcW w:w="4000" w:type="dxa"/></w:tcPr><w:p>' +
    run('Text') +
    tab +
    run('L'.repeat(40)) +
    '</w:p></w:tc></w:tr></w:tbl>';
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${cell}<w:p/></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const lines = linesOf(
    layoutSemanticDocument(read.part, 1, {
      measurer: createFixedMeasurer(6, 12),
      styleCascade: elevenPointDefaults(),
      compatibilityMode: 15,
      geometry: { width: 400, height: 400, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
    })
  );

  // The 200pt cell holds 33 characters; after the 36pt stop the word breaks after 27.
  expect(texts(lines).slice(0, 3)).toEqual(['Text', `\t${'L'.repeat(27)}`, 'L'.repeat(13)]);
});

test('ideographs after a tab break between characters, so the tab stays on its line', () => {
  // Each ideograph is a break opportunity, so the word after the tab is one character wide.
  const lines = layout(run('A'.repeat(50)) + tab + run('日'.repeat(30)));

  expect(texts(lines)[0]!.startsWith(`${'A'.repeat(50)}\t日`)).toBe(true);
});

test('an optional hyphen after a tab ends the word, so the tab stays and the word hyphenates', () => {
  // 300pt of text, a tab to 324pt, then 60pt of letters and a 6pt hyphen fit before 400pt.
  const lines = layout(
    run('A'.repeat(50)) + tab + run('Abcdefghij') + '<w:r><w:softHyphen/></w:r>' + run('klmnopqrst')
  );

  expect(texts(lines)[0]!.startsWith(`${'A'.repeat(50)}\tAbcdefghij`)).toBe(true);
  expect(texts(lines)[1]).toBe('klmnopqrst');
});

test('a second leading tab moves down with a word that fits after one tab on a fresh line', () => {
  // Two tabs reach 72pt, and the 360pt word overflows there. On a fresh line one tab reaches
  // 36pt and the word fits, so the first line keeps only the first tab.
  const lines = layout(tab + tab + run('L'.repeat(60)));

  expect(texts(lines)).toEqual(['\t', `\t${'L'.repeat(60)}`]);
  const word = lines[1]!.spans.find((span) => span.text.startsWith('L'))!;
  expect(word.box.x).toBeCloseTo(36, 5);
});

test('full-width digits after a tab stay one word, so the tab moves down with them', () => {
  // The line breaker keeps a run of full-width digits whole, so the tab carries all of them.
  const lines = layout(run('A'.repeat(50)) + tab + run('１'.repeat(15)));

  expect(texts(lines)[0]).toBe('A'.repeat(50));
  expect(texts(lines)[1]!.startsWith('\t１')).toBe(true);
});

test('a literal U+00AD in the text is a visible hyphen, not a break, so the tab moves down', () => {
  const lines = layout(run('A'.repeat(50)) + tab + run('Abcdefghij­klmnopqrst'));

  expect(texts(lines)).toEqual(['A'.repeat(50), '\tAbcdefghij­klmnopqrst']);
});

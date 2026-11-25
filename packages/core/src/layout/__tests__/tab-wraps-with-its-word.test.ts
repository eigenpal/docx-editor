// Word keeps a tab with the word after it. When the word would overflow the line, the tab
// opens the next line and reaches its stop there. The word does not open the line alone.

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
function layout(content: string, pPr = '') {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr>${pPr}</w:pPr>${content}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  return linesOf(
    layoutSemanticDocument(read.part, 1, {
      measurer: createFixedMeasurer(6, 12),
      styleCascade: elevenPointDefaults(),
      compatibilityMode: 15,
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

test('a word too wide to follow its tab on any line still opens the next line alone', () => {
  // A custom stop at 392pt leaves no room for "12" on a fresh line either.
  const lines = layout(
    run('Text') + tab + run('12'),
    '<w:tabs><w:tab w:val="left" w:pos="7840"/></w:tabs>'
  );

  expect(texts(lines)).toEqual(['Text\t', '12']);
});

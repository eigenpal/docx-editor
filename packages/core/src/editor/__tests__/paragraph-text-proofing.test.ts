import { afterEach, describe, expect, test } from 'bun:test';
import { keptTextRanges } from '../paragraph-text-ranges.ts';
import { textboxDocx } from './textbox-editing-fixture.ts';
import { docx, formatDefaultsDocx } from './paginated-surface-fixtures.ts';
import { mountAnchorEditor, replacePart } from './scroll-to-anchor-fixture.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const run = (text: string, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (...runs: string[]) => `<w:p>${runs.join('')}</w:p>`;

function open(bytes: Uint8Array) {
  const mounted = mountAnchorEditor(bytes);
  cleanups.push(mounted.destroy);
  return mounted.editor;
}

/** A document whose styles set `en-US` by default and a `Code` style that skips proofing. */
function styledDocx(body: string): Uint8Array {
  return replacePart(formatDefaultsDocx(body), 'word/styles.xml', (xml) =>
    xml
      .replace('<w:kern w:val="2"/>', '<w:kern w:val="2"/><w:lang w:val="en-US" w:bidi="ar-SA"/>')
      .replace(
        '</w:styles>',
        '<w:style w:type="character" w:styleId="Code"><w:name w:val="Code"/>' +
          '<w:rPr><w:noProof/></w:rPr></w:style></w:styles>'
      )
  );
}

describe('keptText proofing data', () => {
  test('leaves hidden text out and maps a word around it', () => {
    const editor = open(docx(p(run('rec'), run('XYZ', '<w:vanish/>'), run('eive it'))));
    const [paragraph] = editor.getParagraphs();
    expect(paragraph!.text).toBe('recXYZeive it');
    expect(paragraph!.keptText).toBe('receive it');
    const ranges = keptTextRanges(paragraph!, 0, 7);
    expect(ranges.map((range) => range.expectedText)).toEqual(['rec', 'eive']);
    expect(editor.setHighlights('spelling', ranges)).toEqual({ applied: 2, unavailable: 0 });
  });

  test('a later level of direct formatting shows text that a style hid', () => {
    const editor = open(docx(p(run('shown', '<w:vanish/><w:vanish w:val="0"/>'))));
    expect(editor.getParagraphs()[0]!.keptText).toBe('shown');
  });

  test('reports the language and the proofing flag of each stretch', () => {
    const editor = open(
      styledDocx(
        p(
          run('colour '),
          run('Farbe ', '<w:lang w:val="de-DE"/>'),
          run('fooBar', '<w:rStyle w:val="Code"/>'),
          run(' shalom', '<w:rtl/>')
        )
      )
    );
    const [paragraph] = editor.getParagraphs();
    expect(paragraph!.proofing).toEqual([
      { keptStart: 0, length: 7, lang: 'en-US', noProof: false },
      { keptStart: 7, length: 6, lang: 'de-DE', noProof: false },
      { keptStart: 13, length: 6, lang: 'en-US', noProof: true },
      { keptStart: 19, length: 7, lang: 'ar-SA', noProof: false },
    ]);
    expect(Object.isFrozen(paragraph!.proofing[0])).toBe(true);
  });

  test('proofing stretches follow kept text across a tracked deletion', () => {
    const by = 'w:author="R" w:date="2026-10-07T00:00:00Z"';
    const editor = open(
      docx(
        p(
          run('one ', '<w:lang w:val="en-GB"/>'),
          `<w:del w:id="1" ${by}><w:r><w:delText>gone </w:delText></w:r></w:del>`,
          run('two', '<w:lang w:val="en-GB"/>')
        )
      )
    );
    const [paragraph] = editor.getParagraphs();
    expect(paragraph!.keptText).toBe('one two');
    expect(paragraph!.proofing).toEqual([
      { keptStart: 0, length: 7, lang: 'en-GB', noProof: false },
    ]);
  });

  test('text without a language reports null and an empty paragraph has no stretches', () => {
    const editor = open(docx(p(run('plain')) + p()));
    const [plain, empty] = editor.getParagraphs();
    expect(plain!.proofing).toEqual([{ keptStart: 0, length: 5, lang: null, noProof: false }]);
    expect(empty!.proofing).toEqual([]);
  });

  test('ignores a language value that is not a language tag', () => {
    const editor = open(docx(p(run('text', '<w:lang w:val="&lt;script&gt;"/>'))));
    expect(editor.getParagraphs()[0]!.proofing[0]!.lang).toBeNull();
  });
});

describe('keptTextRanges', () => {
  test('returns nothing for an empty or out-of-range span', () => {
    const editor = open(docx(p(run('word'))));
    const [paragraph] = editor.getParagraphs();
    expect(keptTextRanges(paragraph!, 2, 2)).toEqual([]);
    expect(keptTextRanges(paragraph!, 10, 12)).toEqual([]);
    expect(keptTextRanges(paragraph!, 1, 3)).toEqual([
      { blockId: paragraph!.blockId, start: 1, length: 2, expectedText: 'or' },
    ]);
  });
});

describe('getParagraphText', () => {
  test('returns only paragraphs that getParagraphs lists', () => {
    const boxText = '<w:txbxContent>' + p(run('boxed needle')) + '</w:txbxContent>';
    const bytes = replacePart(textboxDocx(), 'word/document.xml', (xml) =>
      xml.replace(
        '<mc:Fallback><w:pict/></mc:Fallback>',
        '<mc:Fallback><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox>' +
          boxText +
          '</v:textbox></v:shape></w:pict></mc:Fallback>'
      )
    );
    const editor = open(bytes);
    const listed = editor.getParagraphs().find((paragraph) => paragraph.text === 'boxed needle')!;
    expect(editor.getParagraphText(listed.blockId)).toBe(listed);
    // The same text in the `mc:Fallback` copy of the text box, which is never painted.
    expect(editor.getParagraphText('/word/document.xml#0.0.1.0.0.1.0.0.0.0.0')).toBeNull();
    expect(editor.getParagraphText('/word/comments.xml#0.0.0')).toBeNull();
    expect(editor.getParagraphText('nonsense')).toBeNull();
  });
});

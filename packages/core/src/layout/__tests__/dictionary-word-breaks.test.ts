// Thai, Lao, Khmer, and Myanmar text wraps at dictionary word boundaries (#1384).
//
// These scripts put no spaces between words, so the space and dash rules saw a whole clause
// as one word: it moved as one unit and then took an emergency chop that could split a word.
// Paragraph break analysis and table AutoFit now read word boundaries from `Intl.Segmenter`,
// over the paragraph text, so a formatting or revision seam neither adds nor removes a break.

import { afterEach, describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement, type OoxmlNode } from '@docx-editor.dev/core/store';
import {
  dictionaryScriptOf,
  isDictionaryWordBreakSupported,
  dictionaryWordBreaks,
  resetDictionaryWordSegmenter,
  setDictionaryWordSegmenter,
} from '../dictionary-word-breaks.ts';
import * as layoutApi from '../index.ts';
import { breakParagraph } from '../paragraph-flow.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';
import { paragraphMinimumWidthPt } from '../table-autofit-widths.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** 6pt per UTF-16 unit at 11pt, so a 48pt measure holds eight units. */
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

const linesOf = (body: string, width: number): string[] =>
  breakParagraph(paragraph(body), 'p', 0, width, measurer, undefined, null).map((line) =>
    line.spans.map((span) => span.text).join('')
  );

const fieldResult = (instruction: string, result: string) =>
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
  `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(result)}` +
  `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;

const run = (text: string, props = ''): string =>
  `<w:r><w:rPr>${props}<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

const minimumOf = (body: string): number =>
  paragraphMinimumWidthPt(paragraph(body) as OoxmlElement, {
    context: { measurer },
    view: {
      styleCascade: undefined,
      displayMode: 'all-markup',
      authorFilter: undefined,
      readNested: () => null,
    },
    tableCellStyle: undefined,
  });

// "I want to eat rice today": ฉัน|อยาก|กิน|ข้าว|วัน|นี้ (3, 4, 3, 4, 3, 3 units).
const SENTENCE = 'ฉันอยากกินข้าววันนี้';

afterEach(() => resetDictionaryWordSegmenter());

describe('dictionary word boundaries', () => {
  test('this runtime has dictionary data for every supported script', () => {
    expect(isDictionaryWordBreakSupported('thai')).toBe(true);
    expect(isDictionaryWordBreakSupported('lao')).toBe(true);
    expect(isDictionaryWordBreakSupported('khmer')).toBe(true);
    expect(isDictionaryWordBreakSupported('myanmar')).toBe(true);
  });

  test('a Thai sentence splits into its words', () => {
    expect(dictionaryWordBreaks(SENTENCE)).toEqual([3, 7, 10, 14, 17]);
  });

  test('Lao, Khmer, and Myanmar phrases split too', () => {
    expect(dictionaryWordBreaks('ພາສາລາວເປັນພາສາ')).toEqual([4, 7, 11]);
    expect(dictionaryWordBreaks('ភាសាខ្មែរគឺជាភាសា')).toEqual([9, 13]);
    expect(dictionaryWordBreaks('မြန်မာဘာသာစကား')).toEqual([10]);
  });

  test('no cut beside Latin letters, digits, spaces, or between scripts', () => {
    expect(dictionaryWordBreaks('abcไทย123ภาษา')).toEqual([]);
    expect(dictionaryWordBreaks('ไทย ภาษา')).toEqual([]);
    expect(dictionaryWordBreaks('ปี๒๕๖๕')).toEqual([]);
    expect(dictionaryWordBreaks('plain Latin text')).toEqual([]);
  });

  test('tone marks and vowel signs stay with their base letter', () => {
    const text = 'ข้าวน้ำแม่น้ำเจ้าพระยา';
    const cuts = dictionaryWordBreaks(text);
    expect(cuts.length).toBeGreaterThan(0);
    for (const cut of cuts) expect(text[cut]!).not.toMatch(/\p{M}/u);
  });

  test('a segmenter cut inside a grapheme cluster is dropped', () => {
    // A segmenter that cuts after every code unit: the probe rejects it as no dictionary.
    setDictionaryWordSegmenter((run) => Array.from({ length: run.length - 1 }, (_, i) => i + 1));
    expect(isDictionaryWordBreakSupported('thai')).toBe(false);
    expect(dictionaryWordBreaks(SENTENCE)).toEqual([]);
  });

  test('scripts outside the dictionary set are not classified', () => {
    expect(dictionaryScriptOf('a'.codePointAt(0)!)).toBeNull();
    expect(dictionaryScriptOf('๕'.codePointAt(0)!)).toBeNull();
    expect(dictionaryScriptOf('天'.codePointAt(0)!)).toBeNull();
    expect(dictionaryScriptOf('ก'.codePointAt(0)!)).toBe('thai');
    expect(dictionaryScriptOf('ៗ'.codePointAt(0)!)).toBe('khmer');
  });

  test('a long run is segmented in bounded windows with the same cuts', () => {
    const text = SENTENCE.repeat(400);
    const cuts = dictionaryWordBreaks(text);
    const expected: number[] = [];
    for (let i = 0; i < 400; i++)
      for (const cut of [0, 3, 7, 10, 14, 17]) if (i * 20 + cut > 0) expected.push(i * 20 + cut);
    expect(cuts).toEqual(expected);
  });
});

describe('Thai line wrapping', () => {
  test('a narrow paragraph wraps at word boundaries', () => {
    expect(linesOf(`<w:p>${run(SENTENCE)}</w:p>`, 48)).toEqual(['ฉันอยาก', 'กินข้าว', 'วันนี้']);
    expect(linesOf(`<w:p>${run(SENTENCE)}</w:p>`, 60)).toEqual(['ฉันอยากกิน', 'ข้าววันนี้']);
  });

  test('a run seam inside a word is not a break, and formatting does not change the breaks', () => {
    // The seam splits ข้าว after its first letter, in a bold run.
    const split = `<w:p>${run('ฉันอยากกินข')}${run('้าววันนี้', '<w:b/>')}</w:p>`;
    expect(linesOf(split, 48)).toEqual(['ฉันอยาก', 'กินข้าว', 'วันนี้']);
  });

  test('tracked insertions and deletions segment with the text around them', () => {
    const body =
      `<w:p>${run('ฉันอยาก')}` +
      `<w:del w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:delText>ดื่ม</w:delText></w:r></w:del>` +
      `<w:ins w:id="2" w:author="A" w:date="2026-01-01T00:00:00Z">${run('กิน')}</w:ins>` +
      `${run('ข้าววันนี้')}</w:p>`;
    const lines = linesOf(body, 48);
    expect(lines.join('')).toBe('ฉันอยากดื่มกินข้าววันนี้');
    // No line starts with a tone mark or a following vowel sign.
    for (const line of lines) expect(line).not.toMatch(/^\p{M}/u);
    expect(lines[0]).toBe('ฉันอยาก');
  });

  test('mixed Thai, Latin, and digits keep their own rules', () => {
    const lines = linesOf(`<w:p>${run('ฉันอยากABC123กินข้าว')}</w:p>`, 48);
    expect(lines.join('')).toBe('ฉันอยากABC123กินข้าว');
    // The Latin and digit group attaches to the Thai words on both sides (no SA cut there).
    expect(lines[0]).toBe('ฉัน');
  });

  test('Thai with spaces still breaks after the space', () => {
    expect(linesOf(`<w:p>${run('ฉันอยาก กินข้าว')}</w:p>`, 60)).toEqual(['ฉันอยาก ', 'กินข้าว']);
  });

  test('a word wider than the line is chopped only at grapheme boundaries', () => {
    // ข้าว is four units: at 18pt (three units) it must chop, never orphaning the tone mark.
    const lines = linesOf(`<w:p>${run('ข้าว')}</w:p>`, 18);
    expect(lines.join('')).toBe('ข้าว');
    for (const line of lines) expect(line).not.toMatch(/^\p{M}/u);
  });

  test('without dictionary data the paragraph keeps the previous behavior', () => {
    setDictionaryWordSegmenter(null);
    const fallback = linesOf(`<w:p>${run(SENTENCE)}</w:p>`, 54);
    // One word: it is chopped at the margin at grapheme boundaries, never inside a cluster.
    expect(fallback).toEqual(['ฉันอยากกิ', 'นข้าววัน', 'นี้']);
    for (const line of fallback) expect(line).not.toMatch(/^\p{M}/u);
    resetDictionaryWordSegmenter();
    expect(linesOf(`<w:p>${run(SENTENCE)}</w:p>`, 54)).toEqual(['ฉันอยาก', 'กินข้าว', 'วันนี้']);
  });
});

describe('run seams inside a grapheme cluster', () => {
  test('a combining mark in the next run stays with its base letter', () => {
    expect(linesOf(`<w:p>${run('abcde')}${run('\u0301fgh')}</w:p>`, 30)).toEqual([
      'abcde\u0301',
      'fgh',
    ]);
  });

  test('a Thai tone mark in the next run stays with its consonant', () => {
    const lines = linesOf(`<w:p>${run('ข้าวกินน')}${run('้ำ')}</w:p>`, 30);
    expect(lines).toEqual(['ข้าว', 'กิน', 'น้ำ']);
  });

  test('without dictionary data a split Myanmar cluster still stays whole', () => {
    setDictionaryWordSegmenter(null);
    for (const line of linesOf(`<w:p>${run('ข้าวမ')}${run('ြန်မာ')}</w:p>`, 30))
      expect(line).not.toMatch(/^\u103c/u);
  });
});

describe('fields and other layout-owned atoms in dictionary-script paragraphs', () => {
  test('Latin punctuation around a field keeps the rules of a Latin paragraph', () => {
    const thai = `<w:p>${run('ฉันอยาก see p(')}${fieldResult('REF x', '12')}${run(').')}</w:p>`;
    const latin = `<w:p>${run('xxxxxxx see p(')}${fieldResult('REF x', '12')}${run(').')}</w:p>`;
    for (let width = 30; width <= 90; width += 6) {
      // The Thai words may split where the Latin word chops; from "p(" on, the lines match.
      const tail = (lines: string[]) => lines.slice(lines.findIndex((line) => line.includes('p(')));
      expect(tail(linesOf(thai, width))).toEqual(tail(linesOf(latin, width)));
      if (width >= 42) expect(linesOf(thai, width).at(-1)!.endsWith('p(12).')).toBe(true);
    }
  });

  test('a page number between Thai words does not open a line on its own', () => {
    const body = `<w:p>${run('ราคา')}<w:fldSimple w:instr="PAGE">${run('5')}</w:fldSimple>${run('บาท')}</w:p>`;
    expect(linesOf(body, 54)).toEqual(['ราคา5บาท']);
  });

  test('a Thai field result wraps and sizes AutoFit at its words', () => {
    for (const body of [
      `<w:p>${fieldResult('REF heading', SENTENCE)}</w:p>`,
      `<w:p><w:fldSimple w:instr="DOCPROPERTY Title">${run(SENTENCE)}</w:fldSimple></w:p>`,
      `<w:p>${fieldResult('MERGEFIELD name', SENTENCE)}</w:p>`,
    ]) {
      expect(linesOf(body, 48)).toEqual(['ฉันอยาก', 'กินข้าว', 'วันนี้']);
      expect(minimumOf(body)).toBeCloseTo(24, 5);
    }
  });
});

describe('zero-width space', () => {
  const spaced = 'ฉัน\u200bอยาก\u200bกิน\u200bข้าว\u200bวัน\u200bนี้';

  test('a line may end after a zero-width space and never starts with one', () => {
    const lines = linesOf(`<w:p>${run(spaced)}</w:p>`, 60);
    expect(lines).toEqual(['ฉัน\u200bอยาก\u200b', 'กิน\u200bข้าว\u200b', 'วัน\u200bนี้']);
    // Never before a zero-width space, even after a space.
    expect(linesOf(`<w:p>${run('alpha \u200bbeta')}</w:p>`, 42)).toEqual(['alpha \u200b', 'beta']);
    const khmer = linesOf(`<w:p>${run('ភាសា\u200bខ្មែរ\u200bគឺជា\u200bភាសា')}</w:p>`, 60);
    for (const line of khmer) expect(line.startsWith('\u200b')).toBe(false);
  });

  test('it breaks Latin text and AutoFit segments too, also without dictionary data', () => {
    expect(linesOf(`<w:p>${run('alpha\u200bbeta')}</w:p>`, 42)).toEqual(['alpha\u200b', 'beta']);
    setDictionaryWordSegmenter(null);
    // ฉัน plus its zero-width space is the widest of the six words at four units.
    expect(minimumOf(`<w:p>${run(spaced)}</w:p>`)).toBeCloseTo(30, 5);
    expect(minimumOf(`<w:p>${run('ฉัน\u200b')}${run('อยาก')}</w:p>`)).toBeCloseTo(24, 5);
  });
});

describe('a dash that opens a run', () => {
  test('breaks after itself when text precedes it in the run before', () => {
    expect(linesOf(`<w:p>${run('ALPHA')}${run('-PRIME')}</w:p>`, 42)).toEqual(['ALPHA-', 'PRIME']);
    expect(linesOf(`<w:p>${run('ประเทศ')}${run('-ข้าว')}</w:p>`, 30)).toEqual([
      'ประเท',
      'ศ-',
      'ข้าว',
    ]);
    expect(minimumOf(`<w:p>${run('กิน')}${run('-word word')}</w:p>`)).toBeCloseTo(24, 5);
  });
});

describe('public runtime support API', () => {
  test('the layout entry exports detection and the segmenter hooks', () => {
    expect(layoutApi.isDictionaryWordBreakSupported('thai')).toBe(true);
    layoutApi.setDictionaryWordSegmenter(null);
    expect(layoutApi.isDictionaryWordBreakSupported('thai')).toBe(false);
    layoutApi.resetDictionaryWordSegmenter();
    expect(layoutApi.isDictionaryWordBreakSupported('thai')).toBe(true);
  });

  test('an installed segmenter supplies the words, and one that throws gives none', () => {
    // A host dictionary that knows only "ฉัน|อยาก|กิน|ข้าว|วันนี้".
    setDictionaryWordSegmenter((text) =>
      text === 'ฉันอยากกินข้าว' ? [3, 7, 10] : text === SENTENCE ? [3, 7, 10, 14] : []
    );
    expect(dictionaryWordBreaks(SENTENCE)).toEqual([3, 7, 10, 14]);
    setDictionaryWordSegmenter((text) => {
      if (text === 'ฉันอยากกินข้าว') return [3, 7, 10];
      throw new Error('no data');
    });
    expect(dictionaryWordBreaks(SENTENCE)).toEqual([]);
    // Offsets outside the run, unordered, or fractional are ignored.
    setDictionaryWordSegmenter((text) =>
      text === 'ฉันอยากกินข้าว' ? [3, 7, 10] : [0, 99, 7, 3, 2.5, 14]
    );
    expect(dictionaryWordBreaks(SENTENCE)).toEqual([7, 14]);
  });
});

describe('Thai table AutoFit minimum', () => {
  test('the widest Thai word is the minimum segment, not the whole sentence', () => {
    // Widest words are อยาก and ข้าว, four units each.
    expect(minimumOf(`<w:p>${run(SENTENCE)}</w:p>`)).toBeCloseTo(24, 5);
  });

  test('a word split across formatting runs is still one segment', () => {
    expect(minimumOf(`<w:p>${run('ฉันอยากกินข')}${run('้าววันนี้', '<w:b/>')}</w:p>`)).toBeCloseTo(
      24,
      5
    );
    // A seam at a word boundary is a segment end too.
    expect(minimumOf(`<w:p>${run('ฉันอยาก')}${run('กินข้าววันนี้', '<w:i/>')}</w:p>`)).toBeCloseTo(
      24,
      5
    );
  });

  test('without dictionary data the whole run stays one segment', () => {
    setDictionaryWordSegmenter(null);
    expect(minimumOf(`<w:p>${run(SENTENCE)}</w:p>`)).toBeCloseTo(120, 5);
  });
});

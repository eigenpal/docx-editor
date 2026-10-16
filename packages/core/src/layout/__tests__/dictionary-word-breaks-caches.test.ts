// Changing the dictionary segmenter or the grapheme boundary reaches every cache (#1384).
//
// Layout sessions, the paragraph break cache an editor keeps for its lifetime, and the
// dictionary's own run, text, and probe caches must all stop serving breaks taken under the
// previous segmenter or boundary. After a change, an incremental pass equals a clean one.

import { afterEach, describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  dictionaryWordBreaks,
  isDictionaryWordBreakSupported,
  resetDictionaryWordSegmenter,
  setDictionaryWordSegmenter,
} from '../dictionary-word-breaks.ts';
import { resetGraphemeBoundary, setGraphemeBoundary, type GraphemeBoundary } from '../grapheme.ts';
import { createLayoutSession, layoutSemanticDocument, type SemanticLayout } from '../index.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const SENTENCE = 'ฉันอยากกินข้าววันนี้';
const run = (text: string) =>
  `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

function document(extra = ''): OoxmlPart {
  const body =
    `<w:p>${run(SENTENCE)}</w:p><w:p>${run(SENTENCE + extra)}</w:p>` +
    '<w:sectPr><w:pgSz w:w="1500" w:h="20000"/>' +
    '<w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/></w:sectPr>';
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const linesOf = (layout: SemanticLayout): string[] =>
  layout.pages.flatMap((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? [fragment.lines.map((line) => line.spans.map((span) => span.text).join('')).join('|')]
        : []
    )
  );

const WORDS = 'ฉันอยาก|กินข้าว|วันนี้';

afterEach(() => {
  resetDictionaryWordSegmenter();
  resetGraphemeBoundary();
});

describe('a segmenter change re-breaks cached layout', () => {
  test('a layout session re-breaks the same document and later edits', () => {
    const session = createLayoutSession();
    const part = document();
    expect(linesOf(layoutSemanticDocument(part, 1, { measurer, session }))).toEqual([WORDS, WORDS]);
    setDictionaryWordSegmenter(null);
    const clean = linesOf(layoutSemanticDocument(part, 2, { measurer }));
    expect(clean[0]).not.toBe(WORDS);
    expect(linesOf(layoutSemanticDocument(part, 2, { measurer, session }))).toEqual(clean);
    const edited = document('ๆ');
    expect(linesOf(layoutSemanticDocument(edited, 3, { measurer, session }))).toEqual(
      linesOf(layoutSemanticDocument(edited, 3, { measurer }))
    );
    resetDictionaryWordSegmenter();
    expect(linesOf(layoutSemanticDocument(edited, 4, { measurer, session }))).toEqual(
      linesOf(layoutSemanticDocument(edited, 4, { measurer }))
    );
    expect(linesOf(layoutSemanticDocument(edited, 4, { measurer, session }))[0]).toBe(WORDS);
  });

  test('a paragraph break cache without a session re-breaks too', () => {
    const cache = createParagraphLayoutCache<never>();
    const part = document();
    expect(linesOf(layoutSemanticDocument(part, 1, { measurer, cache }))).toEqual([WORDS, WORDS]);
    setDictionaryWordSegmenter(null);
    expect(linesOf(layoutSemanticDocument(part, 2, { measurer, cache }))).toEqual(
      linesOf(layoutSemanticDocument(part, 2, { measurer }))
    );
    resetDictionaryWordSegmenter();
    expect(linesOf(layoutSemanticDocument(part, 3, { measurer, cache }))).toEqual([WORDS, WORDS]);
  });
});

describe('the dictionary caches follow the grapheme boundary', () => {
  // One cluster for the whole text: no cut can fall on a cluster boundary.
  const whole: GraphemeBoundary = {
    segment: (text) =>
      text.length ? [{ index: 0, text, utf16From: 0, utf16To: text.length }] : [],
  };

  test('cuts and the probe are found again after the boundary changes back', () => {
    expect(dictionaryWordBreaks(SENTENCE)).toEqual([3, 7, 10, 14, 17]);
    expect(isDictionaryWordBreakSupported('thai')).toBe(true);
    setGraphemeBoundary(whole);
    expect(dictionaryWordBreaks(SENTENCE)).toEqual([]);
    expect(isDictionaryWordBreakSupported('thai')).toBe(false);
    expect(dictionaryWordBreaks(`${SENTENCE}ๆ`)).toEqual([]);
    resetGraphemeBoundary();
    expect(dictionaryWordBreaks(`${SENTENCE}ๆ`)).toEqual([3, 7, 10, 14, 17]);
    expect(dictionaryWordBreaks(SENTENCE)).toEqual([3, 7, 10, 14, 17]);
    expect(isDictionaryWordBreakSupported('thai')).toBe(true);
  });
});

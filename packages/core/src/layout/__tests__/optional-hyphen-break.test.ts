import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import type { LineRecord } from '../semantic-records.ts';

// At 11pt every character is 6pt wide, so a measure of `chars` characters is `chars * 120`
// twips.
const SOFT = '|';
const SIZE = '<w:rPr><w:sz w:val="22"/></w:rPr>';

function runsOf(text: string): string {
  return text
    .split(SOFT)
    .map((part, index) => (index > 0 ? `<w:r>${SIZE}<w:softHyphen/></w:r>` : '') + textRun(part))
    .join('');
}

function textRun(text: string): string {
  return text ? `<w:r>${SIZE}<w:t xml:space="preserve">${text}</w:t></w:r>` : '';
}

function layoutLines(text: string, chars: number, jc?: string): readonly LineRecord[] {
  const width = Math.round(chars * 120);
  const justification = jc ? `<w:pPr><w:jc w:val="${jc}"/></w:pPr>` : '';
  const opened = readOoxmlPart(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      `<w:p>${justification}${runsOf(text)}</w:p>` +
      `<w:sectPr><w:pgSz w:w="${width + 800}" w:h="6000"/>` +
      '<w:pgMar w:left="400" w:right="400" w:top="200" w:bottom="200"/></w:sectPr>' +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!opened.ok) throw new Error(opened.reason);
  const layout = layoutSemanticDocument(opened.part, 1, { measurer: createFixedMeasurer(6, 14) });
  const paragraph = layout.pages[0]!.fragments.find((fragment) => fragment.kind === 'paragraph')!;
  if (paragraph.kind !== 'paragraph') throw new Error('Missing paragraph');
  return paragraph.lines;
}

/** Each line as a reader sees it: a broken optional hyphen as `-`, any other one as nothing. */
function shown(lines: readonly LineRecord[]): string[] {
  return lines.map((line) =>
    line.spans
      .map((span) => (span.optionalHyphenBreak ? '-' : span.text.replaceAll('­', '')))
      .join('')
  );
}

test('a word that does not fit breaks after its optional hyphen and shows a hyphen', () => {
  const lines = layoutLines('xx aaaa|bbbb', 10);
  expect(shown(lines)).toEqual(['xx aaaa-', 'bbbb']);
  const hyphen = lines[0]!.spans.at(-1)!;
  // Still one model character, painted from U+00AD.
  expect(hyphen.text).toBe('­');
  expect(hyphen.range.end - hyphen.range.start).toBe(1);
  expect(hyphen.range.start).toBe(7);
  expect(hyphen.box.width).toBe(6);
  expect(hyphen.caretEdges).toEqual([0, 6]);
  expect(lines[1]!.spans[0]!.range.start).toBe(8);
});

test('an optional hyphen inside a line that fits shows nothing', () => {
  const lines = layoutLines('xx aaaa|bbbb', 12);
  expect(shown(lines)).toEqual(['xx aaaabbbb']);
  expect(lines[0]!.spans.some((span) => span.optionalHyphenBreak)).toBe(false);
});

test('the visible hyphen must fit, so the word moves and breaks on the next line', () => {
  expect(shown(layoutLines('xx aaaa|bbbb', 7.5))).toEqual(['xx ', 'aaaa-', 'bbbb']);
  expect(shown(layoutLines('xx aaaa|bbbb', 7))).toEqual(['xx ', 'aaaa-', 'bbbb']);
});

test('the line breaks at the last optional hyphen that fits', () => {
  expect(shown(layoutLines('xx aa|bb|cc|dd', 9.5))).toEqual(['xx aabb-', 'ccdd']);
  expect(shown(layoutLines('xx aa|bb|cc|dd', 7.5))).toEqual(['xx aa-', 'bbccdd']);
});

test('an optional hyphen after a space is a later break than the space', () => {
  expect(shown(layoutLines('xx aaaa |bbbbbb', 10))).toEqual(['xx aaaa -', 'bbbbbb']);
});

test('a space after an optional hyphen is the break, and the hyphen stays hidden', () => {
  expect(shown(layoutLines('xx aaaa| bbbbbb', 10))).toEqual(['xx aaaa ', 'bbbbbb']);
});

test('an oversized word still breaks at its optional hyphen', () => {
  expect(shown(layoutLines('aaaaaa|bbbbbb', 5))).toEqual(['aaaaa', 'a-', 'bbbbb', 'b']);
});

test('alignment places the visible hyphen at the right edge', () => {
  for (const jc of ['right', 'both']) {
    const lines = layoutLines('xx aaaa|bbbb yy', 10, jc);
    expect(shown(lines)).toEqual(['xx aaaa-', 'bbbb yy']);
    const hyphen = lines[0]!.spans.at(-1)!;
    expect(hyphen.box.x + hyphen.box.width).toBeCloseTo(lines[0]!.box.x + 60, 6);
  }
});

test('the paragraph text keeps one character per optional hyphen', () => {
  const lines = layoutLines('xx aa|bb|cc|dd', 9.5);
  const spans = lines.flatMap((line) => line.spans);
  expect(spans.map((span) => span.text).join('')).toBe('xx aa­bb­cc­dd');
  expect(spans.at(-1)!.range.end).toBe(14);
});

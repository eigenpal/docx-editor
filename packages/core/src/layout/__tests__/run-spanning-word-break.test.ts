// A word can span RUNS, and a run boundary is not a break opportunity.
//
// `<w:del>which</w:del><w:ins>that</w:ins>` is one word. So is a word whose second half is bold,
// or in another face, or carries any run property at all. Breaking at the run boundary put half
// a word at the end of one line and half at the start of the next — which no word processor
// does, and which then changed where every following line broke, so a document's line and page
// count drifted from Word's.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';
import { breakParagraph } from '../paragraph-flow.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** 6pt per character, so a 60pt measure holds exactly ten. */
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

const linesOf = (body: string, width = 60): string[] =>
  breakParagraph(paragraph(body), 'p', 0, width, measurer, undefined, null).map((line) =>
    line.spans.map((span) => span.text).join('')
  );

// The 6pt measurer base describes an 11pt run, so runs author `w:sz="22"` rather than the
// 10pt terminal fallback (see `DEFAULT_RUN_STYLE`), which widens the measure by 11/10.
const run = (text: string) =>
  `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

describe('a word split across runs stays whole', () => {
  test('two plain runs forming one word', () => {
    // "bbbbbccccc" is ten characters and fills the measure exactly; it must move whole.
    expect(linesOf(`<w:p>${run('aaa ')}${run('bbbbb')}${run('ccccc')}</w:p>`)).toEqual([
      'aaa ',
      'bbbbbccccc',
    ]);
  });

  test('a deletion followed by an insertion is one word', () => {
    // The case that shows up in every reviewed document: a replacement writes the old and new
    // text as adjacent runs with no space between them.
    const body =
      `<w:p>${run('aaa ')}` +
      `<w:del w:id="1" w:author="A" w:date="D"><w:r><w:delText>which</w:delText></w:r></w:del>` +
      `<w:ins w:id="2" w:author="A" w:date="D">${run('that')}</w:ins>` +
      `${run(' zz')}</w:p>`;
    const lines = linesOf(body, 60);
    // Wherever it breaks, "which" and "that" are never separated.
    const joined = lines.join('\n');
    expect(joined).not.toContain('which\n');
    expect(lines.some((line) => line.includes('whichthat'))).toBe(true);
  });

  test('a word made bold halfway through is still one word', () => {
    const body =
      `<w:p>${run('aaa ')}${run('bbbbb')}` +
      '<w:r><w:rPr><w:b/></w:rPr><w:t>ccccc</w:t></w:r></w:p>';
    expect(linesOf(body)).toEqual(['aaa ', 'bbbbbccccc']);
  });

  test('a genuine space between runs is still a break opportunity', () => {
    // The fix must not glue everything together: whitespace at a run boundary still breaks.
    expect(linesOf(`<w:p>${run('aaaaa ')}${run('bbbbb ccccc')}</w:p>`)).toEqual([
      'aaaaa ',
      'bbbbb ',
      'ccccc',
    ]);
  });

  test('a word longer than the measure still breaks, rather than looping', () => {
    // No break opportunity exists inside it, so overflow is the only honest answer.
    const lines = linesOf(`<w:p>${run('aaaaaaaaaaaaaaaaaaaa')}</w:p>`);
    expect(lines.join('')).toBe('aaaaaaaaaaaaaaaaaaaa');
  });

  test('a run-spanning word at the very start of a line cannot be carried anywhere', () => {
    const lines = linesOf(`<w:p>${run('bbbbbbbbbb')}${run('cccccccccc')}</w:p>`);
    expect(lines.join('')).toBe('bbbbbbbbbbcccccccccc');
  });

  test('a tab in its own run is a break opportunity for the text after it', () => {
    // A tab's advance is measured to reach its stop FROM WHERE THE TAB SITS, so a tab must
    // never be carried onto another line as part of a word: the carried copy keeps the
    // advance it was given and stops reaching anything. Text after a tab therefore has to be
    // allowed to open a line — and when the tab has a run to itself, as a generated
    // table-of-contents row does, it is the tab that decides that, not the word before it.
    const body = `<w:p>${run('aa bb')}${run('\t')}${run('ccccc')}</w:p>`;
    expect(linesOf(body)).toEqual(['aa bb\t', 'ccccc']);

    const spans = breakParagraph(paragraph(body), 'p', 0, 60, measurer, undefined, null)[0]!.spans;
    const tabIndex = spans.findIndex((span) => span.text === '\t');
    const before = spans[tabIndex - 1]!;
    const tab = spans[tabIndex]!;
    // The tab begins where the text before it ends and advances to the first stop on the
    // default 36pt grid. Both are read from the run rather than written as point values: the
    // text's width is whatever the measurer and the inherited size make it, while the claim
    // under test — that the advance is measured FROM WHERE THE TAB SITS — is not.
    expect(tab.box.x).toBeCloseTo(before.box.x + before.box.width, 5);
    expect(tab.box.x + tab.box.width).toBe(36);
  });
});

describe('a dash is a break opportunity', () => {
  test('a hyphenated word wraps after the hyphen, the way Word does', () => {
    expect(linesOf(`<w:p>${run('aaaa-bbbb')}</w:p>`, 36)).toEqual(['aaaa-', 'bbbb']);
  });

  test('a deletion-insertion pair still wraps at the insertion’s hyphen', () => {
    // The reviewed-document shape: "alpha" struck through, "ALPHA-PRIME" inserted beside it.
    const body =
      `<w:p>${run('NESTED ')}` +
      `<w:del w:id="1" w:author="A" w:date="D"><w:r><w:delText>alpha</w:delText></w:r></w:del>` +
      `<w:ins w:id="2" w:author="A" w:date="D">${run('ALPHA-PRIME')}</w:ins></w:p>`;
    expect(linesOf(body, 72)).toEqual(['NESTED ', 'alphaALPHA-', 'PRIME']);
  });

  test('a dash ending one run lets the next run open a line', () => {
    expect(linesOf(`<w:p>${run('aaaa-')}${run('bbbb')}</w:p>`, 36)).toEqual(['aaaa-', 'bbbb']);
  });

  test('U+2011 NON-BREAKING HYPHEN is not a break opportunity', () => {
    const lines = linesOf(`<w:p>${run('aaaa‑bbbb')}</w:p>`, 36);
    expect(lines[0]).not.toBe('aaaa‑');
  });
});

describe('a word wider than the measure breaks at the margin', () => {
  // 60pt of measure at 6pt a glyph: exactly ten characters to a line.
  test('an unbroken run chops into full lines instead of overflowing', () => {
    expect(linesOf(`<w:p>${run('aaaaaaaaaaaaaaaaaaaa')}</w:p>`)).toEqual([
      'aaaaaaaaaa',
      'aaaaaaaaaa',
    ]);
  });

  test('the chopped spans keep their model offsets', () => {
    const lines = breakParagraph(
      paragraph(`<w:p>${run('aaaaaaaaaaaabb')}</w:p>`),
      'p',
      0,
      60,
      measurer,
      undefined,
      null
    );
    expect(
      lines.map((line) => line.spans.map((span) => [span.range.start, span.range.end]))
    ).toEqual([[[0, 10]], [[10, 14]]]);
  });

  test('a word that follows text on the line wraps first, then chops', () => {
    expect(linesOf(`<w:p>${run('aaa cccccccccccc')}</w:p>`)).toEqual(['aaa ', 'cccccccccc', 'cc']);
  });
});

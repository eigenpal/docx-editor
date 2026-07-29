// Revision-tagged semantic layout records (tasks 7.1, 7.3).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/engine-core';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
} from '../src/semantic-layout.ts';
import {
  fragmentsOfParagraph,
  lineAtPosition,
  linesOf,
  type PageGeometry,
} from '../src/semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:a="${A}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart, geometry?: PageGeometry, revision = 1) =>
  layoutSemanticDocument(part, revision, { measurer, ...(geometry ? { geometry } : {}) });

/** A small page, so pagination happens without needing pages of text. */
const SMALL: PageGeometry = {
  width: 200,
  height: 100,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

const paragraph = (text: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

describe('layout records carry revision and stable source ranges (task 7.1)', () => {
  test('the layout is tagged with the revision it came from', () => {
    const layout = lay(load(paragraph('hello')), undefined, 42);
    expect(layout.revision).toBe(42);
  });

  test('every line names its paragraph and its UTF-16 range', () => {
    const part = load(paragraph('hello world'));
    const layout = lay(part);
    const [line] = linesOf(layout);
    expect(line!.range.paragraphId).toBe('/word/document.xml#0.0.0');
    expect(line!.range.start).toBe(0);
    expect(line!.range.end).toBe(11);
  });

  test('style spans cover the line text in order, with their own ranges', () => {
    const part = load(
      '<w:p><w:r><w:t>plain </w:t></w:r>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>'
    );
    const [line] = linesOf(lay(part));
    expect(line!.spans.map((span) => span.text)).toEqual(['plain ', 'bold']);
    expect(line!.spans[0]!.range).toMatchObject({ start: 0, end: 6 });
    expect(line!.spans[1]!.range).toMatchObject({ start: 6, end: 10 });
    // The second span carries the run's accepted properties.
    expect(line!.spans[1]!.props).toEqual([{ localName: 'b' }]);
  });

  test('a position maps back to the line that holds it', () => {
    const part = load(paragraph('hello world'));
    const layout = lay(part);
    const id = '/word/document.xml#0.0.0';
    expect(lineAtPosition(layout, id, 0)).not.toBeNull();
    expect(lineAtPosition(layout, id, 11)).not.toBeNull(); // a caret at the very end resolves
    expect(lineAtPosition(layout, id, 99)).toBeNull();
  });

  test('an empty paragraph still produces one line, so it has a caret target', () => {
    const layout = lay(load('<w:p/>'));
    expect(linesOf(layout)).toHaveLength(1);
    expect(linesOf(layout)[0]!.box.height).toBeGreaterThan(0);
  });

  test('spans are positioned left to right within the line', () => {
    const part = load(
      '<w:p><w:r><w:t>abc</w:t></w:r><w:r><w:t>de</w:t></w:r></w:p>'
    );
    const [line] = linesOf(lay(part));
    expect(line!.spans[0]!.box.x).toBe(0);
    expect(line!.spans[1]!.box.x).toBe(18); // 3 characters at 6pt
  });
});

describe('line breaking and pagination (task 7.3)', () => {
  test('text wraps at word boundaries within the content width', () => {
    // 180pt of content at 6pt per character is 30 characters per line.
    const part = load(paragraph('aaaa bbbb cccc dddd eeee ffff gggg hhhh'));
    const layout = lay(part, { ...SMALL, height: 1000 });
    const lines = linesOf(layout);
    expect(lines.length).toBeGreaterThan(1);
    // No line exceeds the available width.
    for (const line of lines) {
      const width = line.spans.reduce((sum, span) => sum + span.box.width, 0);
      expect(width).toBeLessThanOrEqual(180);
    }
    // Every character is accounted for exactly once, in order.
    expect(lines.map((line) => line.spans.map((s) => s.text).join('')).join('')).toBe(
      'aaaa bbbb cccc dddd eeee ffff gggg hhhh'
    );
  });

  test('a hard break ends the line without ending the paragraph', () => {
    const part = load('<w:p><w:r><w:t>a</w:t><w:br/><w:t>b</w:t></w:r></w:p>');
    const layout = lay(part);
    expect(linesOf(layout)).toHaveLength(2);
    // Still ONE paragraph fragment.
    expect(layout.pages[0]!.fragments).toHaveLength(1);
  });

  test('content flows onto a second page when the first is full', () => {
    const many = Array.from({ length: 12 }, (_, index) => paragraph(`line ${index}`)).join('');
    const layout = lay(load(many), SMALL);
    expect(layout.pages.length).toBeGreaterThan(1);
    // Nothing overflows its page's content height.
    for (const page of layout.pages) {
      for (const fragment of page.fragments) {
        expect(fragment.box.y + fragment.box.height).toBeLessThanOrEqual(page.contentBox.height);
      }
    }
  });

  test('a paragraph crossing a page keeps ONE identity across two fragments', () => {
    const long = paragraph(
      Array.from({ length: 40 }, (_, index) => `word${index}`).join(' ')
    );
    const layout = lay(load(long), SMALL);
    const id = '/word/document.xml#0.0.0';
    const fragments = fragmentsOfParagraph(layout, id);
    expect(fragments.length).toBeGreaterThan(1);
    // Same paragraph, consecutive fragment indices, contiguous ranges.
    expect(fragments.map((fragment) => fragment.fragmentIndex)).toEqual(
      fragments.map((_, index) => index)
    );
    for (let index = 1; index < fragments.length; index += 1) {
      expect(fragments[index]!.range.start).toBe(fragments[index - 1]!.range.end);
    }
  });

  test('pageBreakBefore starts a new page', () => {
    const part = load(
      paragraph('first') + paragraph('second', '<w:pageBreakBefore/>')
    );
    const layout = lay(part, { ...SMALL, height: 1000 });
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]!.fragments[0]!.lines[0]!.spans[0]!.text).toBe('first');
    expect(layout.pages[1]!.fragments[0]!.lines[0]!.spans[0]!.text).toBe('second');
  });

  test('a left indent narrows the line and offsets it', () => {
    const part = load(paragraph('indented', '<w:ind w:left="720"/>')); // 720 twips = 36pt
    const [fragment] = layout(part).pages[0]!.fragments;
    expect(fragment!.box.x).toBe(36);
    expect(fragment!.box.width).toBe(468 - 36); // letter content width minus the indent
  });

  function layout(part: OoxmlPart) {
    return lay(part);
  }

  test('a larger font makes taller lines', () => {
    const small = lay(load(paragraph('x')));
    const large = lay(
      load('<w:p><w:r><w:rPr><w:sz w:val="44"/></w:rPr><w:t>x</w:t></w:r></w:p>')
    );
    expect(linesOf(large)[0]!.box.height).toBeGreaterThan(linesOf(small)[0]!.box.height);
  });

  test('unknown content occupies no text offset, keeping offsets in step with the ops', () => {
    const part = load(
      '<w:p><w:r><w:t>ab</w:t></w:r>' +
        '<w:r><w:drawing><a:graphic uri="urn:clip"/></w:drawing></w:r>' +
        '<w:r><w:t>cd</w:t></w:r></w:p>'
    );
    const [line] = linesOf(lay(part));
    // 'ab' then 'cd' with no gap: the drawing contributes no addressable offset, exactly as
    // the tree ops and the binding treat it.
    expect(line!.range.end).toBe(4);
    expect(line!.spans.map((span) => span.text).join('')).toBe('abcd');
  });
});

describe('layout is deterministic', () => {
  test('the same tree and measurer produce identical records', () => {
    const part = load(paragraph('deterministic output') + paragraph('second'));
    expect(JSON.stringify(lay(part))).toBe(JSON.stringify(lay(part)));
  });
});

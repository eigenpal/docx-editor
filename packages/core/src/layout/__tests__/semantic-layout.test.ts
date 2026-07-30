// Revision-tagged semantic layout records (tasks 7.1, 7.3).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core-contract/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import {
  fragmentsOfParagraph,
  lineAtPosition,
  linesOf,
  type PageGeometry,
} from '../semantic-records.ts';

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
      '<w:p><w:r><w:t>plain </w:t></w:r>' + '<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>'
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
    const part = load('<w:p><w:r><w:t>abc</w:t></w:r><w:r><w:t>de</w:t></w:r></w:p>');
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
    const long = paragraph(Array.from({ length: 40 }, (_, index) => `word${index}`).join(' '));
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
    const part = load(paragraph('first') + paragraph('second', '<w:pageBreakBefore/>'));
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
    const large = lay(load('<w:p><w:r><w:rPr><w:sz w:val="44"/></w:rPr><w:t>x</w:t></w:r></w:p>'));
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

describe('resolved style reaches measurement and the spans (task 7.2)', () => {
  test('a span carries the resolved style, not just the raw properties', () => {
    const part = load(
      '<w:p><w:r><w:rPr><w:b/><w:sz w:val="44"/><w:color w:val="C00000"/></w:rPr>' +
        '<w:t>styled</w:t></w:r></w:p>'
    );
    const [line] = linesOf(lay(part));
    const span = line!.spans[0]!;
    expect(span.style.bold).toBe(true);
    expect(span.style.fontSizePt).toBe(22);
    expect(span.style.color).toBe('C00000');
    // The authored properties are retained alongside as evidence.
    expect(span.props).toHaveLength(3);
  });

  test('character spacing widens the line', () => {
    const plain = lay(load('<w:p><w:r><w:t>abcde</w:t></w:r></w:p>'));
    const spaced = lay(
      load('<w:p><w:r><w:rPr><w:spacing w:val="40"/></w:rPr><w:t>abcde</w:t></w:r></w:p>')
    );
    const width = (l: ReturnType<typeof linesOf>) =>
      l[0]!.spans.reduce((sum, span) => sum + span.box.width, 0);
    // 40 twips is 2pt per character across five characters.
    expect(width(linesOf(spaced))).toBeCloseTo(width(linesOf(plain)) + 10, 5);
  });

  test('horizontal scaling widens the line proportionally', () => {
    const plain = lay(load('<w:p><w:r><w:t>abcde</w:t></w:r></w:p>'));
    const scaled = lay(
      load('<w:p><w:r><w:rPr><w:w w:val="200"/></w:rPr><w:t>abcde</w:t></w:r></w:p>')
    );
    const width = (l: ReturnType<typeof linesOf>) =>
      l[0]!.spans.reduce((sum, span) => sum + span.box.width, 0);
    expect(width(linesOf(scaled))).toBeCloseTo(width(linesOf(plain)) * 2, 5);
  });

  test('caps text is measured as DRAWN, not as authored', () => {
    // Uppercasing changes nothing about width under a fixed measurer, but it must be the
    // drawn string that is measured — a proportional shaper would size them differently.
    const part = load('<w:p><w:r><w:rPr><w:caps/></w:rPr><w:t>abc</w:t></w:r></w:p>');
    const [line] = linesOf(lay(part));
    expect(line!.spans[0]!.style.caps).toBe(true);
    // The span keeps the SOURCE text, so a copy reproduces what the document holds.
    expect(line!.spans[0]!.text).toBe('abc');
  });

  test('superscript occupies less line height than baseline text', () => {
    const baseline = lay(load('<w:p><w:r><w:t>x</w:t></w:r></w:p>'));
    const superscript = lay(
      load('<w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>x</w:t></w:r></w:p>')
    );
    expect(linesOf(superscript)[0]!.box.height).toBeLessThan(linesOf(baseline)[0]!.box.height);
  });
});

describe('paragraph alignment moves the published span boxes (w:jc)', () => {
  // Alignment has to be geometry, not CSS: the painter draws the boxes layout publishes and
  // hit testing reads the same ones, so `text-align` would put the caret where no glyph is.
  const geometry: PageGeometry = {
    width: 200,
    height: 400,
    margin: { top: 10, right: 10, bottom: 10, left: 10 },
  };
  const available = geometry.width - 20;
  const firstSpan = (jc: string) =>
    linesOf(lay(load(paragraph('ab cd', jc ? `<w:jc w:val="${jc}"/>` : '')), geometry))[0]!;

  test('left alignment leaves spans at the indent', () => {
    expect(firstSpan('left').spans[0]!.box.x).toBe(0);
  });

  test('right alignment pushes the line flush to the right edge', () => {
    const line = firstSpan('right');
    const last = line.spans[line.spans.length - 1]!;
    // Trailing whitespace hangs past the edge, so the visible text ends exactly at it.
    expect(last.box.x + last.box.width).toBeCloseTo(available, 5);
    expect(line.spans[0]!.box.x).toBeGreaterThan(0);
  });

  test('centre alignment leaves equal slack on both sides', () => {
    const line = firstSpan('center');
    const last = line.spans[line.spans.length - 1]!;
    const leading = line.spans[0]!.box.x;
    const trailing = available - (last.box.x + last.box.width);
    expect(leading).toBeCloseTo(trailing, 5);
  });

  test('`start` and `end` resolve as left and right', () => {
    expect(firstSpan('start').spans[0]!.box.x).toBe(0);
    expect(firstSpan('end').spans[0]!.box.x).toBeGreaterThan(0);
  });

  test('an unknown w:jc value falls back to left rather than throwing', () => {
    expect(firstSpan('someFutureValue').spans[0]!.box.x).toBe(0);
  });

  test('the LAST line of a justified paragraph is never stretched', () => {
    // Two lines: the first is justified, the second is set flush left like Word does.
    const words = Array.from({ length: 14 }, (_, index) => `w${index}`).join(' ');
    const body = paragraph(words, '<w:jc w:val="both"/>');
    const lines = linesOf(lay(load(body), geometry));
    expect(lines.length).toBeGreaterThan(1);
    const last = lines[lines.length - 1]!;
    expect(last.spans[0]!.box.x).toBe(0);
    // Justified earlier lines gain space between words, so a later span sits past where the
    // unjustified cumulative advance would have put it.
    const first = lines[0]!;
    const secondSpan = first.spans[1]!;
    expect(secondSpan.box.x).toBeGreaterThan(first.spans[0]!.box.width);
  });

  test('alignment composes with indentation instead of replacing it', () => {
    const body = paragraph('ab cd', '<w:jc w:val="right"/><w:ind w:left="200"/>');
    const line = linesOf(lay(load(body), geometry))[0]!;
    const last = line.spans[line.spans.length - 1]!;
    // 200 twips = 10pt of indent; the right edge is measured from it, not from the margin.
    expect(last.box.x + last.box.width).toBeCloseTo(10 + (available - 10), 5);
  });
});

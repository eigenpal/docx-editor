// The page the document asks for (task 11.1 follow-through).
//
// Every value here comes from an attacker-controlled attribute, so the tests are as much
// about what is REFUSED as about what is read: a page size is a loop bound for pagination,
// and a document claiming a page a mile tall must not be able to make the engine try.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/engine-core';
import {
  DEFAULT_SECTION_PROPERTIES,
  geometryOfSection,
  readSectionProperties,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const withSection = (sectPr: string) =>
  load(`<w:p><w:r><w:t>x</w:t></w:r></w:p><w:sectPr>${sectPr}</w:sectPr>`);

describe('a section is read from the document (task 11.1)', () => {
  test('a document with no sectPr gets Word’s defaults, not zero', () => {
    expect(readSectionProperties(load('<w:p/>'))).toEqual(DEFAULT_SECTION_PROPERTIES);
  });

  test('A4 is read as A4, so it does not paginate as Letter', () => {
    // The reason this matters: the page size decides where the lines and the pages break,
    // so getting it wrong is wrong before anything is painted.
    const section = readSectionProperties(withSection('<w:pgSz w:w="11906" w:h="16838"/>'));
    expect(section.pageSize).toEqual({ widthTwips: 11906, heightTwips: 16838 });
  });

  test('margins are read, including header, footer and gutter', () => {
    const section = readSectionProperties(
      withSection(
        '<w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" ' +
          'w:header="360" w:footer="360" w:gutter="180"/>'
      )
    );
    expect(section.margins).toEqual({
      topTwips: 720,
      rightTwips: 1080,
      bottomTwips: 720,
      leftTwips: 1080,
      headerTwips: 360,
      footerTwips: 360,
      gutterTwips: 180,
    });
  });

  test('landscape and a title page are read', () => {
    const section = readSectionProperties(
      withSection('<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:titlePg/>')
    );
    expect(section.landscape).toBe(true);
    expect(section.titlePage).toBe(true);
  });

  test('columns are read, with a sane count', () => {
    const section = readSectionProperties(withSection('<w:cols w:num="3" w:space="540"/>'));
    expect(section.columns).toEqual({ count: 3, gapTwips: 540 });
  });

  test('a NEGATIVE margin is honoured, because content may bleed into it', () => {
    const section = readSectionProperties(withSection('<w:pgMar w:left="-720"/>'));
    expect(section.margins.leftTwips).toBe(-720);
  });
});

describe('hostile section values are refused, not honoured (task 11.1)', () => {
  test('an absurd page size falls back rather than becoming a pagination bound', () => {
    // A page size is a loop bound: honouring a million inches would paginate until memory
    // ran out.
    const section = readSectionProperties(withSection('<w:pgSz w:w="999999999" w:h="999999999"/>'));
    expect(section.pageSize).toEqual(DEFAULT_SECTION_PROPERTIES.pageSize);
  });

  test('a zero or negative page size falls back', () => {
    expect(readSectionProperties(withSection('<w:pgSz w:w="0" w:h="0"/>')).pageSize).toEqual(
      DEFAULT_SECTION_PROPERTIES.pageSize
    );
    expect(readSectionProperties(withSection('<w:pgSz w:w="-100" w:h="-100"/>')).pageSize).toEqual(
      DEFAULT_SECTION_PROPERTIES.pageSize
    );
  });

  test('a non-numeric value falls back rather than becoming NaN', () => {
    // NaN geometry produces NaN line positions, which paint as nothing and hit-test as
    // nowhere — a failure with no error attached to it.
    const section = readSectionProperties(withSection('<w:pgSz w:w="__proto__" w:h="abc"/>'));
    expect(section.pageSize).toEqual(DEFAULT_SECTION_PROPERTIES.pageSize);
    expect(Number.isFinite(section.margins.leftTwips)).toBe(true);
  });

  test('a hostile column count cannot divide the content width to nothing', () => {
    expect(readSectionProperties(withSection('<w:cols w:num="0"/>')).columns.count).toBe(1);
    expect(readSectionProperties(withSection('<w:cols w:num="99999"/>')).columns.count).toBe(12);
  });
});

describe('section properties become the geometry layout paginates against', () => {
  test('twips convert to points', () => {
    const geometry = geometryOfSection(DEFAULT_SECTION_PROPERTIES);
    expect(geometry).toEqual({
      width: 612,
      height: 792,
      margin: { top: 72, right: 72, bottom: 72, left: 72 },
    });
  });

  test('the gutter is added to the left margin, not taken out of the content', () => {
    // It is binding allowance on the inner edge. Folding it into the content width instead
    // would silently narrow every line without moving the text.
    const geometry = geometryOfSection({
      ...DEFAULT_SECTION_PROPERTIES,
      margins: { ...DEFAULT_SECTION_PROPERTIES.margins, gutterTwips: 720 },
    });
    expect(geometry.margin.left).toBe(108);
  });

  test('margins that swallow the page fall back rather than producing a zero content area', () => {
    // Paginating into a column of zero height never terminates.
    const geometry = geometryOfSection({
      ...DEFAULT_SECTION_PROPERTIES,
      margins: {
        ...DEFAULT_SECTION_PROPERTIES.margins,
        leftTwips: 20000,
        rightTwips: 20000,
      },
    });
    expect(geometry.width).toBe(612);
  });
});

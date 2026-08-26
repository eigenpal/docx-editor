// The `\#` numeric picture switch: what it renders, and what it refuses.
import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../index.ts';
import { formatNumericPicture, MAX_NUMERIC_PICTURE_CHARS } from '../field-numeric-picture.ts';
import { allowlistedPageField, matchAllowlistedPageField } from '../field-instruction.ts';
import {
  numericPictureApplies,
  pageFieldPlaceholder,
  projectPageFieldValue,
  PAGE_FIELD_PLACEHOLDER,
} from '../field-page-furniture.ts';

describe('numeric picture rendering', () => {
  test('fills digit positions from the right', () => {
    expect(formatNumericPicture(2, '0#')).toBe('02');
    expect(formatNumericPicture(12, '0#')).toBe('12');
    expect(formatNumericPicture(7, '000')).toBe('007');
    // An unfilled `#` paints a space, as Word does: `{ = 9 + 6 \# $### }` renders `$ 15`.
    expect(formatNumericPicture(7, '###')).toBe('  7');
    expect(formatNumericPicture(15, '$###')).toBe('$ 15');
  });

  test('keeps every digit of a value wider than the picture, grouping included', () => {
    expect(formatNumericPicture(1234, '0#')).toBe('1234');
    expect(formatNumericPicture(100, '0')).toBe('100');
    // Overflow digits repeat the interval the picture's separator established, as Word does.
    expect(formatNumericPicture(1234567, '#,###')).toBe('1,234,567');
    expect(formatNumericPicture(1234567, '#,##0')).toBe('1,234,567');
  });

  test('paints a grouping comma when a required position fills to its left', () => {
    // `0` paints a digit even where the value ran out, so the separator before it stays.
    expect(formatNumericPicture(5, '0,000')).toBe('0,005');
    expect(formatNumericPicture(12, '00,000')).toBe('00,012');
    expect(formatNumericPicture(0, '0,000')).toBe('0,000');
    // `#` paints nothing there, so the separator goes with it.
    expect(formatNumericPicture(5, '#,##0')).toBe('   5');
  });

  test('paints literals, and a grouping comma only with a digit to its left', () => {
    expect(formatNumericPicture(2, 'Page 0')).toBe('Page 2');
    expect(formatNumericPicture(1234, '#,##0')).toBe('1,234');
    expect(formatNumericPicture(5, '#,##0')).toBe('   5');
    expect(formatNumericPicture(1000, '#,###')).toBe('1,000');
  });

  test('refuses a picture with no digit position, an oversized one, or a bad value', () => {
    expect(formatNumericPicture(2, '')).toBeNull();
    expect(formatNumericPicture(2, 'Page')).toBeNull();
    expect(formatNumericPicture(2, '0'.repeat(MAX_NUMERIC_PICTURE_CHARS + 1))).toBeNull();
    expect(formatNumericPicture(Number.NaN, '0#')).toBeNull();
    expect(formatNumericPicture(-1, '0#')).toBeNull();
  });

  test('refuses a fractional picture rather than filling it right to left', () => {
    // `0.00` splits into integral and fractional positions that fill in opposite directions.
    // Word renders 3 as `3.00`; a strict right-to-left fill would say `0.03`.
    expect(formatNumericPicture(3, '0.00')).toBeNull();
    expect(formatNumericPicture(1234, '#,##0.00')).toBeNull();
  });
});

describe('page-field instructions carrying a picture', () => {
  test('allowlists the keyword and reads its picture', () => {
    expect(allowlistedPageField(' PAGE \\# 0# ')).toBe('PAGE');
    expect(matchAllowlistedPageField(' PAGE \\# 0# ')).toEqual({ kind: 'PAGE', picture: '0#' });
    expect(matchAllowlistedPageField('NUMPAGES \\# "000"')).toEqual({
      kind: 'NUMPAGES',
      picture: '000',
    });
    expect(matchAllowlistedPageField('PAGE')).toEqual({ kind: 'PAGE' });
  });

  test('keeps the picture case the author wrote', () => {
    expect(matchAllowlistedPageField('PAGE \\# "Page 0"')?.picture).toBe('Page 0');
  });

  test('leaves a field inert when another switch rides with the picture', () => {
    expect(allowlistedPageField('PAGE \\n 3 \\# 0#')).toBeNull();
    expect(allowlistedPageField('INCLUDETEXT "http://example.invalid" \\# 0#')).toBeNull();
    expect(matchAllowlistedPageField('DATE \\# 0#')).toBeNull();
  });

  test('projects the computed value through the picture', () => {
    expect(projectPageFieldValue('PAGE', { pageNumber: 2, pageCount: 9 }, '0#')).toBe('02');
    expect(projectPageFieldValue('NUMPAGES', { pageNumber: 2, pageCount: 9 }, '000')).toBe('009');
    // An unusable picture falls back to the plain number, never to a cached result.
    expect(projectPageFieldValue('PAGE', { pageNumber: 2, pageCount: 9 }, 'Page')).toBe('2');
    // A non-decimal page format has no digits for a picture to place, so the format wins.
    expect(
      projectPageFieldValue('PAGE', { pageNumber: 4, pageCount: 9, format: 'lowerRoman' }, '0#')
    ).toBe('iv');
    // An authored `w:fmt="decimal"` — which Word writes — IS decimal, so the picture applies.
    expect(
      projectPageFieldValue('PAGE', { pageNumber: 2, pageCount: 9, format: 'decimal' }, '0#')
    ).toBe('02');
  });

  test('measures a body placeholder at the width the picture will paint', () => {
    // Finalize substitutes the value without re-measuring, so the placeholder has to be the
    // shape of every value that can replace it.
    expect(pageFieldPlaceholder(undefined)).toBe(PAGE_FIELD_PLACEHOLDER);
    expect(pageFieldPlaceholder('0#')).toBe('00');
    // A `#`-only picture is as wide as every value it can hold, not one digit wide: zero
    // fills the last position and the unfilled ones pad, so `15` and `7` measure the same.
    expect(pageFieldPlaceholder('###')).toBe('  0');
    expect(formatNumericPicture(15, '###')).toHaveLength(3);
    expect(pageFieldPlaceholder('Page 0 of')).toBe('Page 0 of');
    // An unusable picture paints the plain number, so its placeholder is the plain digit.
    expect(pageFieldPlaceholder('Page')).toBe(PAGE_FIELD_PLACEHOLDER);
    // And a non-decimal page format wins over the picture, so the placeholder drops it too —
    // measuring `Page 0 of` for a value the section renders as `III` reserves 9 for 3.
    expect(pageFieldPlaceholder('Page 0 of', 'upperRoman')).toBe(PAGE_FIELD_PLACEHOLDER);
    expect(pageFieldPlaceholder('0#', 'upperRoman')).toBe(PAGE_FIELD_PLACEHOLDER);
    expect(pageFieldPlaceholder('0#', 'decimal')).toBe('00');
    expect(numericPictureApplies(undefined)).toBe(true);
    expect(numericPictureApplies('decimal')).toBe(true);
    expect(numericPictureApplies('upperRoman')).toBe(false);
  });
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** A two-page body whose last paragraph is a PAGE field, followed by text on the same line. */
function bodyPageFieldDoc(instruction: string, pageNumberFormat?: string): Uint8Array {
  const filler = Array.from(
    { length: 60 },
    (_unused, index) => `<w:p><w:r><w:t>Line ${index + 1}</w:t></w:r></w:p>`
  ).join('');
  const field =
    '<w:p>' +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:instrText xml:space="preserve"> ${instruction} </w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
    '<w:r><w:t>END</w:t></w:r>' +
    '</w:p>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${filler}${field}` +
        '<w:sectPr>' +
        (pageNumberFormat ? `<w:pgNumType w:fmt="${pageNumberFormat}"/>` : '') +
        '<w:pgSz w:w="12240" w:h="15840"/>' +
        '<w:pgMar w:top="1080" w:right="720" w:bottom="1080" w:left="720"/></w:sectPr>' +
        '</w:body></w:document>'
    ),
  });
}

describe('a body page field carrying a picture', () => {
  /**
   * The field's painted text, the gap the flow left for it, and what one character measures.
   *
   * The character width is READ from the `END` span rather than assumed: the fixed measurer's
   * advance scales with the resolved font size, and the point of the assertion is that the gap
   * and the painted text agree — not what either is in absolute points.
   */
  function fieldLine(
    instruction: string,
    pageNumberFormat?: string
  ): { field: string; gap: number; charWidth: number } {
    const loaded = readOoxmlPackage(bodyPageFieldDoc(instruction, pageNumberFormat));
    if (!loaded.ok) throw new Error('load failed');
    const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
    const layout = layoutSemanticDocument(part, 1, {
      measurer: createFixedMeasurer(6, 14),
      producer: 'test',
    });
    expect(layout.pages.length).toBe(2);
    for (const fragment of layout.pages[1]!.fragments) {
      if (fragment.kind !== 'paragraph') continue;
      for (const line of fragment.lines) {
        const end = line.spans.find((span) => span.text === 'END');
        const field = line.spans[0];
        if (!end || !field || field === end) continue;
        // The GAP the field was measured into, against the text finalize substituted for it.
        return {
          field: field.text,
          gap: end.box.x - field.box.x,
          charWidth: end.box.width / 'END'.length,
        };
      }
    }
    throw new Error('field line not found');
  }

  test('paints the picture and places following text past its full width', () => {
    const line = fieldLine('PAGE \\# 0#');
    expect(line.field).toBe('02');
    // Measured at `00`, so `END` sits two characters along. Measured at one digit, the
    // substituted `02` would paint its second digit over `END`.
    expect(line.gap).toBeCloseTo(2 * line.charWidth, 6);
  });

  test('keeps the one-digit measurement for a field with no picture', () => {
    const line = fieldLine('PAGE');
    expect(line.field).toBe('2');
    expect(line.gap).toBeCloseTo(line.charWidth, 6);
  });

  test('measures the format, not the picture, when the section is not decimal', () => {
    // `w:pgNumType w:fmt="upperRoman"` wins over the picture, so the placeholder must drop it
    // too: measuring `Page 0 of` and painting `II` leaves following text at the wrong x.
    const line = fieldLine('PAGE \\# "Page 0 of"', 'upperRoman');
    expect(line.field).toBe('II');
    // One character, the plain-number placeholder — nine would be the picture's width, which
    // nothing on this page ever paints. `II` still overruns by one, exactly as an unpictured
    // multi-digit value does; what must not happen is reserving a width the format never uses.
    expect(line.gap).toBeCloseTo(line.charWidth, 6);
  });
});

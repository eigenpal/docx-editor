// The field codes of a complex field can run over paragraph marks, as the quoted text of an
// `IF` field does (ECMA-376 §17.16.18). Only the field result displays, so a paragraph that
// starts and ends inside the field codes takes no line, shows no list marker, and advances no
// list counter.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { buildNumberingIndex } from '../numbering-index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { linesOf, type PageGeometry } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const measurer = createFixedMeasurer(6, 14);

const PAGE: PageGeometry = {
  width: 400,
  height: 400,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
};

function read(xml: string, name = '/word/document.xml'): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const numberingIndex = buildNumberingIndex(
  read(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    '/word/numbering.xml'
  ).root
);

const text = (value: string) => `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`;
const instr = (value: string) =>
  `<w:r><w:instrText xml:space="preserve">${value}</w:instrText></w:r>`;
const fldChar = (type: 'begin' | 'separate' | 'end') =>
  `<w:r><w:fldChar w:fldCharType="${type}"/></w:r>`;
const para = (content: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`;
const item = (content: string) =>
  para(content, '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');

function laidOut(body: string, showFieldCodes = false) {
  const result = layoutSemanticDocument(
    read(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`),
    1,
    { measurer, geometry: PAGE, numberingIndex, showFieldCodes }
  );
  return {
    layout: result,
    lines: linesOf(result).map((line) => line.spans.map((span) => span.text).join('')),
    markers: result.pages.flatMap((page) =>
      page.fragments.flatMap((fragment) =>
        fragment.kind === 'paragraph' && fragment.marker ? [fragment.marker.text] : []
      )
    ),
  };
}

const lineTexts = (body: string) => laidOut(body).lines;

/** An `IF` field whose quoted text is `paragraphs`, with `result` saved, or no result. */
const ifField = (paragraphs: string[], result: string | null) =>
  [
    para(`${text('before ')}${fldChar('begin')}${instr('IF "A" = "A" "')}`),
    ...paragraphs,
    para(
      `${instr('" ""')}${result === null ? '' : `${fldChar('separate')}${text(result)}`}${fldChar('end')}${text(' after')}`
    ),
  ].join('');

describe('paragraphs inside a field instruction', () => {
  test('take no line, show no list marker, and advance no list counter', () => {
    const inside = [para(instr('Clause')), para(''), item(instr('Item')), item('')];
    const result = laidOut(
      `${item(text('first'))}${ifField(inside, 'Result')}${item(text('last'))}`
    );

    expect(result.lines.map((line) => line.trim())).toEqual([
      'first',
      'before Result after',
      'last',
    ]);
    expect(result.markers).toEqual(['1.', '2.']);
  });

  test('take no line when the field has no saved result', () => {
    expect(lineTexts(ifField([para(instr('Clause')), para('')], null))).toEqual(['before  after']);
  });

  test('take no line when they hold a nested field result', () => {
    const nested = para(
      `${fldChar('begin')}${instr('REF Answer')}${fldChar('separate')}${text('A')}${fldChar('end')}`
    );

    expect(lineTexts(ifField([nested, para('')], 'Result'))).toEqual(['before Result after']);
  });

  test('take no line inside a field nested in another field result', () => {
    const body =
      para(`${fldChar('begin')}${instr('QUOTE ')}${fldChar('separate')}${text('outer')}`) +
      ifField([para(instr('inner'))], 'shown') +
      para(`${text('end')}${fldChar('end')}`);

    expect(lineTexts(body)).toEqual(['outer', 'before shown after', 'end']);
  });
});

describe('paragraphs inside a field instruction in a table cell', () => {
  test('advance no list counter', () => {
    const inside = [item(instr('Item')), item('')];
    const cell = `${item(text('first'))}${ifField(inside, 'Result')}${item(text('last'))}`;
    const result = laidOut(`<w:tbl><w:tr><w:tc>${cell}</w:tc></w:tr></w:tbl><w:p/>`);
    expect(result.lines.map((line) => line.trim())).toEqual([
      'first',
      'before Result after',
      'last',
      '',
    ]);
    // Cell paragraphs sit inside the table fragment.
    const markers = [...JSON.stringify(result.layout).matchAll(/"marker":\{"text":"([^"]*)"/g)];
    expect(markers.map((match) => match[1])).toEqual(['1.', '2.']);
  });
});

describe('paragraphs that keep their line', () => {
  test('a field result that spans paragraphs', () => {
    const body =
      para(`${fldChar('begin')}${instr('REF Clause')}${fldChar('separate')}${text('one')}`) +
      para(text('two')) +
      para(`${text('three')}${fldChar('end')}`);

    expect(lineTexts(body)).toEqual(['one', 'two', 'three']);
  });

  test('a field with plain text in its field codes', () => {
    expect(lineTexts(ifField([para(text('stray')), para('')], 'Result'))).toEqual([
      'before ',
      'stray',
      '',
      'Result after',
    ]);
  });

  test('a field without an end', () => {
    const body =
      para(`${fldChar('begin')}${instr('IF "')}`) +
      para(text('kept')) +
      para('') +
      para(text('last'));

    expect(lineTexts(body)).toEqual(['', 'kept', '', 'last']);
  });
});

// The mark of the paragraph that holds `begin` is field code too, so the text before the field
// and the text after its field codes share one line. Each span keeps its own paragraph.
describe('the paragraphs on either side of the field codes', () => {
  const paragraphsOf = (body: string) => {
    const { layout } = laidOut(body);
    return layout.pages.flatMap((page) =>
      page.fragments.flatMap((fragment) => (fragment.kind === 'paragraph' ? [fragment] : []))
    );
  };
  const field = (beginPPr: string, lastPPr: string) =>
    para(`${text('before ')}${fldChar('begin')}${instr('IF "A" = "A" "')}`, beginPPr) +
    para(instr('Clause')) +
    para(
      `${instr('" ""')}${fldChar('separate')}${text('Result')}${fldChar('end')}${text(' after')}`,
      lastPPr
    );

  test('share one line, and each span maps to the paragraph that holds it', () => {
    const [line] = laidOut(field('', '')).layout.pages[0]!.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' ? fragment.lines : []
    );
    expect(
      line!.spans.map((span) => [span.text, span.range.paragraphId, span.range.start])
    ).toEqual([
      ['before ', '/word/document.xml#0.0.0', 0],
      ['Result', '/word/document.xml#0.0.2', 0],
      [' ', '/word/document.xml#0.0.2', 6],
      ['after', '/word/document.xml#0.0.2', 7],
    ]);
  });

  test('share one line when no paragraph sits wholly inside the field codes', () => {
    const body =
      para(`${text('before ')}${fldChar('begin')}${instr('IF "A" = "A" "x')}`) +
      para(`${instr('" ""')}${fldChar('separate')}${text('Result')}${fldChar('end')}`);
    expect(lineTexts(body)).toEqual(['before Result']);
  });

  test('take the first paragraph properties and the last paragraph space after', () => {
    const [merged] = paragraphsOf(
      field(
        '<w:spacing w:before="200"/><w:jc w:val="center"/>',
        '<w:spacing w:after="300"/><w:jc w:val="right"/>'
      )
    );
    expect(merged!.alignment).toBe('center');
    expect(merged!.spacing.before).toBe(10);
    expect(merged!.spacing.after).toBe(15);
  });

  test('count the last list item but show no number for either', () => {
    const numbered = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
    const opening = laidOut(`${item(text('first'))}${field(numbered, '')}${item(text('last'))}`);
    expect(opening.markers).toEqual(['1.', '2.']);
    const closing = laidOut(`${item(text('first'))}${field('', numbered)}${item(text('last'))}`);
    expect(closing.markers).toEqual(['1.', '3.']);
    expect(closing.lines.map((line) => line.trim())).toEqual([
      'first',
      'before Result after',
      'last',
    ]);
  });

  test('show no result for a field nested in the field codes', () => {
    // The nested field is part of the instruction, on either side of the paragraph marks.
    const quote = (value: string) =>
      `${fldChar('begin')}${instr(`QUOTE "${value}"`)}${fldChar('separate')}${text(value)}${fldChar('end')}`;
    const body =
      para(
        `${text('before ')}${fldChar('begin')}${instr('IF ')}${quote('A')}${instr(' = "A" "')}`
      ) +
      para(instr('Clause')) +
      para(
        `${instr('" "')}${quote('B')}${instr('"')}${fldChar('separate')}${text('Result')}${fldChar('end')}${text(' after')}`
      );
    expect(lineTexts(body)).toEqual(['before Result after']);
  });

  test('keep a run that mixes field codes with displayed text', () => {
    const body =
      para(
        `${text('before ')}<w:r><w:t xml:space="preserve">x </w:t><w:fldChar w:fldCharType="begin"/></w:r>${instr('IF "A" = "A" "')}`
      ) +
      para(instr('Clause')) +
      para(`${instr('" ""')}${fldChar('separate')}${text('Result')}${fldChar('end')}`);
    expect(lineTexts(body)).toEqual(['before x Result']);
  });

  test('keep their own lines when another field crosses on from the last paragraph', () => {
    const body =
      field('', '').slice(0, -'</w:p>'.length) +
      `${fldChar('begin')}${instr('IF "B" = "B" "')}</w:p>` +
      para(`${instr('" ""')}${fldChar('separate')}${text('Next')}${fldChar('end')}`);
    expect(lineTexts(body)).toEqual(['before ', 'Result after', 'Next']);
  });
});

// A content control can wrap a paragraph inside the field codes. Its mark is still field code,
// so a table cell and the top level of a story count and lay it out the same way.
describe('a content control around a field-code paragraph', () => {
  const sdt = (content: string) =>
    `<w:sdt><w:sdtPr/><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
  const numbered = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
  const bodies = {
    'a wrapped list item': `${item(text('first'))}${ifField([sdt(item(instr('Item')))], 'Result')}${item(text('last'))}`,
    'a list item that opens the field': `${item(text('first'))}${ifField([], 'Result').replace('<w:p>', `<w:p><w:pPr>${numbered}</w:pPr>`)}${item(text('last'))}`,
  };
  for (const [label, body] of Object.entries(bodies)) {
    test(`counts ${label} the same in a table cell and at the top level`, () => {
      const top = laidOut(body);
      const cell = laidOut(`<w:tbl><w:tr><w:tc>${body}</w:tc></w:tr></w:tbl><w:p/>`);
      const lines = ['first', 'before Result after', 'last'];
      expect(top.lines.map((line) => line.trim())).toEqual(lines);
      expect(cell.lines.map((line) => line.trim())).toEqual([...lines, '']);
      expect(top.markers).toEqual(['1.', '2.']);
      const cellMarkers = [...JSON.stringify(cell.layout).matchAll(/"marker":\{"text":"([^"]*)"/g)];
      expect(cellMarkers.map((match) => match[1])).toEqual(['1.', '2.']);
    });
  }
});

// A field nested past the field machine's cap is left out on its own. The fields around it and
// every other field in the story still hide their field-code paragraphs.
describe('a field nested past the nesting cap', () => {
  test('leaves the other fields of the story alone', () => {
    const deep =
      `${fldChar('begin')}${instr('IF ')}`.repeat(4) +
      `${fldChar('begin')}${instr('MERGEFIELD x')}${fldChar('separate')}${text('x')}${fldChar('end')}` +
      `${instr(' = "x" "y" "n"')}${fldChar('separate')}${text('y')}${fldChar('end')}`.repeat(4);
    const lines = lineTexts(
      para(`${text('deep ')}${deep}`) + ifField([para(instr('Clause')), para('')], 'Result')
    );
    expect(lines.at(-1)).toBe('before Result after');
    expect(lines).toHaveLength(2);
  });

  test('leaves the field around it in force', () => {
    const deepInside = para(
      `${fldChar('begin')}${instr('IF ')}`.repeat(4) + `${fldChar('end')}`.repeat(4)
    );
    // The outer IF already holds one open field, so the fifth level is past the cap.
    expect(lineTexts(ifField([deepInside, para('')], 'Result'))).toEqual(['before Result after']);
  });

  test('counts the result text of a field past the cap as stray text, conservatively', () => {
    // The outer IF and three nested IF fields are tracked; the REF field is the fifth level.
    // Its saved result reads as stray text, so the outer IF keeps its paragraphs.
    const nested =
      `${fldChar('begin')}${instr('IF ')}`.repeat(3) +
      `${fldChar('begin')}${instr('REF x')}${fldChar('separate')}${text('x')}${fldChar('end')}` +
      `${fldChar('end')}`.repeat(3);
    expect(lineTexts(ifField([para(nested), para('')], 'Result'))).toEqual([
      'before ',
      '',
      '',
      'Result after',
    ]);
  });
});

// Showing field instructions applies to table of contents fields. An `IF` field keeps its saved
// result, and the paragraphs inside its field codes still take no line.
describe('paragraphs inside a field instruction with field instructions shown', () => {
  test('take no line', () => {
    const shown = laidOut(ifField([para(instr('Clause')), para('')], 'Result'), true).lines;
    expect(shown.map((line) => line.trim())).toEqual(['before Result after']);
    expect(shown.join('')).not.toContain('Clause');
  });
});

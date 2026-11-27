// A superscript or subscript paragraph mark and the line box of its paragraph.
//
// `w:vertAlign` (CT_VerticalAlignRun, ECMA-376 17.3.2.42) repositions text "without altering
// the font size of the run properties", and the paragraph mark takes run properties like any
// character (CT_ParaRPr, 17.3.1.29). In anonymous probes, three 12pt paragraphs that hold only
// superscript or only subscript text, with a mark of the same alignment, sit one 12pt line
// apart, and so do three empty paragraphs with such a mark. The same holds when the alignment
// comes from a character style or a paragraph style, in a table cell, in a header, on the
// empty last line after a break, and in compatibility modes 12, 14 and 15. The size of a
// script mark does not size a line that holds text. A line that holds only the line break of
// a script run is a full line too, with a plain mark or a script mark. Exact and at-least
// spacing above the natural line, a mixed line, and plain text under a script mark do not
// change.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import {
  buildStyleCascadeTable,
  caretAt,
  layoutSemanticDocument,
  linesOf,
  type SemanticLayout,
  type TextMeasurer,
} from '../index.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { glyphSizeFactorOf, type ResolvedRunStyle } from '../run-style.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Size-aware metrics: line height 1.15em, baseline 0.9em, script text at its glyph size. */
const size = (style: ResolvedRunStyle) => style.fontSizePt * glyphSizeFactorOf(style);
const measurer: TextMeasurer = {
  measure: (text, style) => text.length * size(style) * 0.5,
  lineMetrics: (style) => ({ height: size(style) * 1.15, baseline: size(style) * 0.9 }),
};
const line = (sizePt: number) => sizePt * 1.15;

function part(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}
const body = (content: string) =>
  part(`<w:document xmlns:w="${W}"><w:body>${content}</w:body></w:document>`, '/word/document.xml');

/** 12pt Normal, a superscript character style, and a subscript paragraph style. */
const styleCascade = buildStyleCascadeTable(
  part(
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      '<w:rPr><w:sz w:val="24"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="Raised">' +
      '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Lowered"><w:basedOn w:val="Normal"/>' +
      '<w:rPr><w:vertAlign w:val="subscript"/></w:rPr></w:style></w:styles>',
    '/word/styles.xml'
  ).root
);

type Align = 'superscript' | 'subscript';
const SPACING = '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>';
const align = (value: Align) => `<w:vertAlign w:val="${value}"/>`;
const markOf = (properties: string) => (properties ? `<w:rPr>${properties}</w:rPr>` : '');
const paragraph = (content: string, mark = '', paragraphProperties = SPACING) =>
  `<w:p><w:pPr>${paragraphProperties}${markOf(mark)}</w:pPr>${content}</w:p>`;
const run = (text: string, properties = '') =>
  `<w:r><w:rPr>${properties}</w:rPr><w:t>${text}</w:t></w:r>`;

const lay = (content: string) =>
  layoutSemanticDocument(body(content), 1, { measurer, styleCascade });
const heights = (layout: SemanticLayout) => linesOf(layout).map((record) => record.box.height);
const paragraphIds = (layout: SemanticLayout) =>
  layout.pages.flatMap((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph' ? [fragment.paragraphId] : []
    )
  );
const shapeOf = (layout: SemanticLayout) =>
  linesOf(layout).map((record) => [record.box.y, record.box.height, record.baseline]);

for (const value of ['superscript', 'subscript'] as const) {
  describe(`a ${value} paragraph mark`, () => {
    test('leaves a line of script text at the full line of its run', () => {
      const layout = lay(
        paragraph(run('Sigma', align(value)), align(value)) +
          paragraph(run('Sigma', align(value)), align(value)) +
          paragraph(run('After'))
      );
      expect(heights(layout)).toEqual([line(12), line(12), line(12)]);
      const [first, second, after] = linesOf(layout);
      expect(first!.baseline).toBeCloseTo(12 * 0.9, 5);
      expect(second!.box.y - first!.box.y).toBeCloseTo(line(12), 5);
      expect(after!.box.y - first!.box.y).toBeCloseTo(2 * line(12), 5);
    });

    test('gives an empty paragraph the full line of the mark size', () => {
      const layout = lay(
        paragraph('', align(value)) +
          paragraph('', `<w:sz w:val="48"/>${align(value)}`) +
          paragraph('', `<w:sz w:val="16"/>${align(value)}`)
      );
      expect(heights(layout)).toEqual([line(12), line(24), line(8)]);
      expect(linesOf(layout)[0]!.baseline).toBeCloseTo(12 * 0.9, 5);
    });

    test('gives a line of spaces and the empty line after a break the full line', () => {
      const layout = lay(
        paragraph(run('   '), align(value)) +
          paragraph('<w:r><w:t>Sigma</w:t><w:br/></w:r>', align(value))
      );
      expect(heights(layout)).toEqual([line(12), line(12), line(12)]);
    });

    test('does not size a line that holds text', () => {
      const layout = lay(
        paragraph(run('Sigma', align(value)), `<w:sz w:val="48"/>${align(value)}`) +
          paragraph(run('Sigma', align(value)), `<w:sz w:val="16"/>${align(value)}`) +
          paragraph(run('Sigma'), `<w:sz w:val="48"/>${align(value)}`)
      );
      expect(heights(layout)).toEqual([line(12), line(12), line(12)]);
    });
  });
}

test('a line that holds only the break of a script run keeps the full line', () => {
  const script = align('superscript');
  const broken = (content: string) => `<w:r><w:rPr>${script}</w:rPr>${content}</w:r>`;
  const layout = lay(
    // A break before the text, with a plain mark and with a script mark.
    paragraph(broken('<w:br/><w:t>Sigma</w:t>')) +
      paragraph(broken('<w:br/><w:t>Sigma</w:t>'), script) +
      // An empty line between two lines of plain text, made by the break of a script run.
      paragraph(`<w:r><w:t>Sigma</w:t><w:br/></w:r>${broken('<w:br/>')}<w:r><w:t>tau</w:t></w:r>`)
  );
  expect(heights(layout)).toEqual(Array(7).fill(line(12)));
});

test('the break of a script run sizes a line as the break of a plain run of that size does', () => {
  // 8pt text, then the break of a 24pt run: superscript, subscript, and plain.
  const text = run('Sigma', '<w:sz w:val="16"/>');
  const breakOf = (properties: string) =>
    `<w:r><w:rPr><w:sz w:val="48"/>${properties}</w:rPr><w:br/></w:r>`;
  const shape = (properties: string) => shapeOf(lay(paragraph(text + breakOf(properties) + text)));
  expect(shape(align('superscript'))).toEqual(shape(''));
  expect(shape(align('subscript'))).toEqual(shape(''));
});

test('the run and the mark can have different alignments', () => {
  const layout = lay(
    paragraph(run('Sigma', align('superscript')), align('subscript')) +
      paragraph(
        run('Sigma ', align('superscript')) + run('tau', align('subscript')),
        align('superscript')
      )
  );
  expect(heights(layout)).toEqual([line(12), line(12)]);
});

test('the alignment can come from a character style or a paragraph style', () => {
  const raised = '<w:rStyle w:val="Raised"/>';
  const lowered = `<w:pStyle w:val="Lowered"/>${SPACING}`;
  const layout = lay(
    paragraph(run('Sigma', raised), raised) +
      paragraph('', raised) +
      paragraph('<w:r><w:t>Sigma</w:t></w:r>', '', lowered) +
      paragraph('', '', lowered)
  );
  expect(heights(layout)).toEqual(Array(4).fill(line(12)));
});

test('a script run sizes its line by its own size, not by the paragraph cascade', () => {
  const small = `<w:sz w:val="16"/>${align('superscript')}`;
  const large = `<w:sz w:val="36"/>${align('subscript')}`;
  const layout = lay(paragraph(run('Sigma', small), small) + paragraph(run('Sigma', large), large));
  expect(heights(layout)[0]).toBeCloseTo(line(8), 5);
  expect(heights(layout)[1]).toBeCloseTo(line(18), 5);
});

test('multiple line spacing scales the full line and at-least spacing is a floor', () => {
  const spacing = (rule: string, value: number) =>
    `<w:spacing w:before="0" w:after="0" w:line="${value}" w:lineRule="${rule}"/>`;
  const script = run('Sigma', align('superscript'));
  const mark = align('superscript');
  const layout = lay(
    paragraph(script, mark, spacing('auto', 360)) +
      paragraph('', mark, spacing('auto', 360)) +
      paragraph(script, mark, spacing('atLeast', 120)) +
      paragraph('', mark, spacing('atLeast', 120)) +
      paragraph(script, mark, spacing('atLeast', 400)) +
      paragraph(script, mark, spacing('exact', 280)) +
      paragraph('', mark, spacing('exact', 280))
  );
  const expected = [1.5 * line(12), 1.5 * line(12), line(12), line(12), 20, 14, 14];
  heights(layout).forEach((height, index) => expect(height).toBeCloseTo(expected[index]!, 5));
});

test('the lines of table cells follow the same rule', () => {
  const cell = (content: string) => `<w:tc>${content}</w:tc>`;
  const row = (content: string) => `<w:tr>${cell(content)}</w:tr>`;
  const table =
    '<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
    row(paragraph('')) +
    row(paragraph('', align('subscript'))) +
    row(paragraph(run('Sigma', align('superscript')), align('superscript'))) +
    '</w:tbl>';
  // The three cell lines; the layout adds the body's closing paragraph after the table.
  expect(heights(lay(table)).slice(0, 3)).toEqual([line(12), line(12), line(12)]);
});

describe('controls', () => {
  test('plain text and a mixed line under a script mark keep the line of their text', () => {
    const mark = align('superscript');
    const layout = lay(
      paragraph(run('Sigma'), mark) +
        paragraph(run('Sigma ') + run('tau', mark), mark) +
        paragraph(run('Sigma'))
    );
    expect(heights(layout)).toEqual([line(12), line(12), line(12)]);
  });

  test('a raised run (w:position, 17.3.2.24) still grows its line, with or without the mark', () => {
    const raised = '<w:position w:val="8"/>';
    const [marked, unmarked] = heights(
      lay(paragraph(run('Sigma', raised), raised) + paragraph(run('Sigma', raised)))
    );
    expect(marked).toBeGreaterThan(line(12));
    expect(marked).toBe(unmarked!);
  });
});

describe('editing a paragraph with a script mark', () => {
  test('an incremental layout agrees with a full layout while the mark changes', () => {
    const script = run('Sigma', align('superscript'));
    const versions = [
      paragraph(script) + paragraph('') + paragraph(run('After')),
      paragraph(script, align('superscript')) +
        paragraph('', align('superscript')) +
        paragraph(run('After')),
      paragraph(script, align('subscript')) +
        paragraph('', align('subscript')) +
        paragraph(run('After')),
      paragraph(run('Sigma'), align('superscript')) +
        paragraph(run('x', align('subscript')), align('subscript')) +
        paragraph(run('After')),
      paragraph(script) + paragraph('') + paragraph(run('After')),
    ];
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache();
    versions.forEach((content, index) => {
      const warm = layoutSemanticDocument(body(content), index + 1, {
        measurer,
        styleCascade,
        session,
        cache,
      });
      expect(shapeOf(warm)).toEqual(shapeOf(lay(content)));
      expect(heights(warm)).toEqual([line(12), line(12), line(12)]);
    });
  });

  test('the caret of script text and of the empty paragraph does not move with the mark', () => {
    const document = (scriptMark: string, emptyMark: string) =>
      lay(paragraph(run('Sigma', align('superscript')), scriptMark) + paragraph('', emptyMark));
    const layout = document(align('superscript'), align('subscript'));
    const plain = document('', '');
    const [scriptLine, emptyLine] = linesOf(layout);
    const [scriptId, emptyId] = paragraphIds(layout);
    const [plainScriptId, plainEmptyId] = paragraphIds(plain);
    for (const offset of [0, 3, 5]) {
      const caret = caretAt(layout, { paragraphId: scriptId!, offset }, measurer)!;
      const control = caretAt(plain, { paragraphId: plainScriptId!, offset }, measurer)!;
      expect(caret.lineId).toBe(scriptLine!.id);
      expect([caret.x, caret.y, caret.height]).toEqual([control.x, control.y, control.height]);
      // The caret follows the raised glyphs: it is as tall as the smaller glyph line.
      expect(caret.height).toBeCloseTo(line(12) * 0.65, 5);
    }
    const caret = caretAt(layout, { paragraphId: emptyId!, offset: 0 }, measurer)!;
    const control = caretAt(plain, { paragraphId: plainEmptyId!, offset: 0 }, measurer)!;
    expect(caret.lineId).toBe(emptyLine!.id);
    expect(caret.y).toBe(emptyLine!.box.y);
    expect([caret.x, caret.y, caret.height]).toEqual([control.x, control.y, control.height]);
  });
});

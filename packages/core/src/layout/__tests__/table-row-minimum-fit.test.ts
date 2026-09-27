// A splittable row with an `atLeast` minimum height starts on a page only when that minimum
// fits the room left there. Otherwise the row moves to the next page, and a `w:keepNext`
// paragraph before the table moves with it. When the minimum fits, the row starts and splits
// as any other row. Compatibility modes 14 and 15 and an absent mode give the same pages.
//
// The page is 400pt square with 50pt margins: a 300pt body. A filler line of 170pt or 210pt
// and a 14pt caption leave 116pt or 76pt for the row. The row has one cell of nine exact
// 14pt lines (126pt) in four paragraphs, and no cell margins.

import { describe, expect, test } from 'bun:test';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { read, W } from './table-row-keep-fixtures.ts';

const styleCascade = buildStyleCascadeTable(
  read(
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      '<w:name w:val="Normal"/></w:style></w:styles>',
    '/word/styles.xml'
  ).root
);
const measurer = createFixedMeasurer(6, 14);

interface Probe {
  readonly filler: number;
  readonly minimum: number;
  readonly keep: boolean;
  readonly widow: boolean;
  readonly mode?: number;
  readonly table?: string;
  /** Lines of the cell's first paragraph; 3 by default. */
  readonly firstLines?: number;
}

const para = (label: string, lines = 1, height = 14, pPr = '') =>
  `<w:p><w:pPr>${pPr}<w:spacing w:before="0" w:after="0" w:line="${height * 20}" ` +
  `w:lineRule="exact"/></w:pPr><w:r>` +
  Array.from({ length: lines }, (_, n) => `${n ? '<w:br/>' : ''}<w:t>${label}-${n + 1}</w:t>`).join(
    ''
  ) +
  '</w:r></w:p>';

const rowXml = (minimum: number, widow: boolean, trPr = '', firstLines = 3) => {
  const height = minimum
    ? `<w:trHeight w:val="${Math.round(minimum * 20)}" w:hRule="atLeast"/>`
    : '';
  const widowPr = `<w:widowControl w:val="${widow ? 1 : 0}"/>`;
  const content = [firstLines, 2, 3, 1]
    .map((lines, n) => para(`CELL${n}`, lines, 14, widowPr))
    .join('');
  return (
    `<w:tr><w:trPr>${height}${trPr}</w:trPr>` +
    `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="5000"/></w:tcPr>${content}</w:tc></w:tr>`
  );
};

const tableXml = (rows: string) =>
  '<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="5000"/><w:tblLayout w:type="fixed"/>' +
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
  `<w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>${rows}</w:tbl>`;

const SECT =
  '<w:sectPr><w:pgSz w:w="8000" w:h="8000"/><w:pgMar w:top="1000" w:bottom="1000" ' +
  'w:left="1000" w:right="1000" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';

function layOut(probe: Probe) {
  const caption = (probe.keep ? '<w:keepNext/>' : '') + '<w:keepLines/><w:widowControl w:val="0"/>';
  const body =
    para('FILL', 1, probe.filler, '<w:widowControl w:val="0"/>') +
    para('CAP', 1, 14, caption) +
    (probe.table ?? tableXml(rowXml(probe.minimum, probe.widow, '', probe.firstLines))) +
    para('TAIL', 1, 14, '<w:widowControl w:val="0"/>');
  const part = read(
    `<w:document xmlns:w="${W}"><w:body>${body}${SECT}</w:body></w:document>`,
    '/word/document.xml'
  );
  return layoutSemanticDocument(part, 1, {
    measurer,
    styleCascade,
    ...('mode' in probe ? { compatibilityMode: probe.mode } : { compatibilityMode: 15 }),
  });
}

/** The page, from 1, of the first line of every marker. */
function markerPages(probe: Probe): Record<string, number> {
  const found: Record<string, number> = {};
  const visit = (fragment: unknown, page: number): void => {
    const block = fragment as {
      kind: string;
      lines?: { spans: { text: string }[] }[];
      rows?: { cells: { blocks: unknown[] }[] }[];
    };
    if (block.kind === 'paragraph') {
      for (const line of block.lines ?? []) {
        const text = line.spans.map((span) => span.text).join('');
        for (const marker of text.match(/[A-Z]+[0-9]?-[0-9]+/g) ?? []) found[marker] ??= page;
      }
      return;
    }
    for (const placed of block.rows ?? [])
      for (const cell of placed.cells) for (const inner of cell.blocks) visit(inner, page);
  };
  layOut(probe).pages.forEach((page, index) => {
    for (const fragment of page.fragments) visit(fragment, index + 1);
  });
  return found;
}

const MARKERS = ['CAP-1', 'CELL0-1', 'CELL0-3', 'CELL1-1', 'CELL2-1', 'CELL3-1', 'TAIL-1'];
const expectPagesIn = (probe: Probe, pages: readonly number[]) => {
  const found = markerPages(probe);
  expect(MARKERS.map((marker) => found[marker])).toEqual([...pages]);
};

// Captured controls. Widow control does not change the first page.
for (const mode of [undefined, 14, 15]) {
  describe(`an atLeast row starts only where its minimum fits (mode ${mode ?? 'absent'})`, () => {
    for (const keep of [false, true]) {
      for (const widow of [false, true]) {
        const flags = `keepNext ${keep ? 'on' : 'off'}, widow control ${widow ? 'on' : 'off'}`;
        const expectPages = (probe: Omit<Probe, 'keep' | 'widow' | 'mode'>, pages: number[]) =>
          expectPagesIn({ ...probe, keep, widow, mode }, pages);

        test(`no minimum splits in 116pt and in 76pt (${flags})`, () => {
          expectPages({ filler: 170, minimum: 0 }, [1, 1, 1, 1, 1, 2, 2]);
          expectPages({ filler: 210, minimum: 0 }, [1, 1, 1, 1, 2, 2, 2]);
        });

        test(`a 89.8pt minimum starts in 116pt and splits (${flags})`, () => {
          expectPages({ filler: 170, minimum: 89.8 }, [1, 1, 1, 1, 1, 2, 2]);
        });

        test(`a 89.8pt minimum does not start in 76pt (${flags})`, () => {
          const caption = keep ? 2 : 1;
          expectPages({ filler: 210, minimum: 89.8 }, [caption, 2, 2, 2, 2, 2, 2]);
        });

        test(`a 170pt minimum does not start in 116pt or 76pt (${flags})`, () => {
          const caption = keep ? 2 : 1;
          for (const filler of [170, 210])
            expectPages({ filler, minimum: 170 }, [caption, 2, 2, 2, 2, 2, 2]);
        });

        // Captured without widow control only.
        if (!widow)
          test(`a row taller than a page moves when its minimum does not fit (${flags})`, () => {
            // The first paragraph has 30 lines: 504pt of content in a 300pt body.
            const found = markerPages({
              filler: 210,
              minimum: 89.8,
              keep,
              widow,
              mode,
              firstLines: 30,
            });
            const markers = ['CAP-1', 'CELL0-1', 'CELL0-30', 'TAIL-1'];
            expect(markers.map((marker) => found[marker])).toEqual([keep ? 2 : 1, 2, 3, 3]);
          });
      }
    }
  });
}

describe('bounds of the minimum fit rule', () => {
  test('an exact row taller than the room still moves whole', () => {
    const exact = '<w:trHeight w:val="1796" w:hRule="exact"/>';
    const table = tableXml(rowXml(0, false, exact));
    const found = markerPages({ filler: 210, minimum: 0, keep: false, widow: false, table });
    expect([found['CAP-1'], found['CELL0-1'], found['TAIL-1']]).toEqual([1, 2, 2]);
  });

  test('a continuation fragment does not need the minimum', () => {
    // A 100pt minimum fits the 116pt room, so twenty lines (280pt) start there. The rest
    // continues at the top of page 2 without a minimum of its own.
    const cell = para('CELL0', 20, 14, '<w:widowControl w:val="0"/>');
    const big =
      '<w:tr><w:trPr><w:trHeight w:val="2000" w:hRule="atLeast"/></w:trPr>' +
      `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="5000"/></w:tcPr>${cell}</w:tc></w:tr>`;
    const found = markerPages({
      filler: 170,
      minimum: 0,
      keep: false,
      widow: false,
      table: tableXml(big),
    });
    expect([found['CELL0-1'], found['CELL0-9'], found['TAIL-1']]).toEqual([1, 2, 2]);
  });

  test('a row at the top of a page starts there', () => {
    const table = tableXml(rowXml(170, false));
    const part = read(
      `<w:document xmlns:w="${W}"><w:body>${table}${para('TAIL')}${SECT}</w:body></w:document>`,
      '/word/document.xml'
    );
    const layout = layoutSemanticDocument(part, 1, {
      measurer,
      styleCascade,
      compatibilityMode: 15,
    });
    expect(layout.pages).toHaveLength(1);
  });

  test('a later row that does not fit its minimum moves after the rows before it', () => {
    const rows = rowXml(0, false).replace(/CELL/g, 'LEAD') + rowXml(89.8, false);
    const table = tableXml(rows);
    // The lead row fills 126pt below a 60pt filler and the caption: 100pt remain, enough for
    // the minimum. Below a 100pt filler 60pt remain, and the second row moves.
    const found = (filler: number) =>
      markerPages({ filler, minimum: 0, keep: false, widow: false, table });
    expect([found(60)['LEAD3-1'], found(60)['CELL0-1']]).toEqual([1, 1]);
    expect([found(100)['LEAD3-1'], found(100)['CELL0-1']]).toEqual([1, 2]);
  });

  test('a minimum taller than a page is left to the ordinary row rules', () => {
    // A 400pt minimum no page can hold: the row starts in the 76pt room and splits.
    const found = markerPages({ filler: 210, minimum: 400, keep: false, widow: false });
    expect([found['CAP-1'], found['CELL0-1'], found['CELL3-1']]).toEqual([1, 1, 2]);
  });

  test('header rows move with a body row whose minimum does not fit', () => {
    const header =
      '<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:tcW w:type="dxa" w:w="5000"/>' +
      `</w:tcPr>${para('HEAD')}</w:tc></w:tr>`;
    const table = tableXml(header + rowXml(89.8, false));
    // Below a 196pt filler and the caption, 90pt remain: the header row fits, the minimum
    // below it does not.
    const found = markerPages({ filler: 196, minimum: 0, keep: false, widow: false, table });
    expect([found['CAP-1'], found['HEAD-1'], found['CELL0-1'], found['TAIL-1']]).toEqual([
      1, 2, 2, 2,
    ]);
  });
});

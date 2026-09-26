// `w:keepNext` on a body table row (§17.3.1.15): the row stays on the page where the next row,
// or the paragraph after the table, starts.
//
// A row keeps when the first paragraph of its first cell resolves `w:keepNext`. Kept rows move
// whole, together with the kept rows before them, when they and the opening of what follows do
// not fit the page. A splittable successor row needs only the first lines of every cell.
// Header rows keep with the first body rows the same way, and a keepNext paragraph before a
// table moves with the table's header rows and that opening.
//
// The page shape is 350pt by 210pt with 20pt margins: a 170pt body that holds twelve exact
// 14pt lines. Eight preamble lines leave four.

import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  TreeDocumentStore,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { keptRowGroup, smallestOpening, type KeptRowSource } from '../table-row-keeps.ts';
import type { BlockFragmentRecord, SemanticLayout } from '../semantic-records.ts';
import type { SemanticTableRow } from '../semantic-table.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function read(xml: string, name: string): OoxmlPart {
  const result = readOoxmlPart(xml, { name, contentType: 'app/xml' });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const SECT =
  '<w:sectPr><w:pgSz w:w="7000" w:h="4200"/><w:pgMar w:top="400" w:bottom="400" ' +
  'w:left="400" w:right="400" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
const load = (body: string) =>
  read(
    `<w:document xmlns:w="${W}"><w:body>${body}${SECT}</w:body></w:document>`,
    '/word/document.xml'
  );

// `Kept` inherits `w:keepNext` through `basedOn`; `KeepTable` states it in its table style.
const styleCascade = buildStyleCascadeTable(
  read(
    `<w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="KeepBase"><w:basedOn w:val="Normal"/>' +
      '<w:pPr><w:keepNext/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Kept"><w:basedOn w:val="KeepBase"/></w:style>' +
      '<w:style w:type="table" w:styleId="KeepTable"><w:pPr><w:keepNext/></w:pPr></w:style>' +
      '</w:styles>',
    '/word/styles.xml'
  ).root
);

const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart, compatibilityMode = 15, extra: object = {}): SemanticLayout =>
  layoutSemanticDocument(part, 1, { measurer, styleCascade, compatibilityMode, ...extra });

interface ParaOptions {
  readonly keep?: boolean | 'off';
  readonly keepLines?: boolean;
  readonly widow?: boolean;
  readonly style?: string;
}

/** One paragraph of `count` lines named `${name}1` to `${name}N`, via hard breaks. */
const para = (name: string, count = 1, options: ParaOptions = {}) => {
  const pPr =
    (options.style ? `<w:pStyle w:val="${options.style}"/>` : '') +
    (options.keep === true
      ? '<w:keepNext/>'
      : options.keep === 'off'
        ? '<w:keepNext w:val="0"/>'
        : '') +
    (options.keepLines ? '<w:keepLines/>' : '') +
    (options.widow ? '' : '<w:widowControl w:val="0"/>') +
    '<w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="exact"/>';
  const runs = Array.from({ length: count }, (_, i) => `<w:t>${name}${i + 1}</w:t>`);
  return `<w:p><w:pPr>${pPr}</w:pPr><w:r>${runs.join('<w:br/>')}</w:r></w:p>`;
};

const cell = (content: string, tcPr = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${tcPr}</w:tcPr>${content}</w:tc>`;

interface RowOptions {
  /** Lines of the first cell's paragraph. */
  readonly lines?: number;
  /** `w:keepNext` on the first and second cell's paragraph. */
  readonly keep?: readonly [boolean, boolean];
  readonly cantSplit?: boolean;
  readonly header?: boolean;
  readonly exactTwips?: number;
  /** Replaces the first cell's content. */
  readonly first?: string;
  readonly firstTcPr?: string;
}

const row = (name: string, options: RowOptions = {}) => {
  const trPr =
    (options.cantSplit ? '<w:cantSplit/>' : '') +
    (options.header ? '<w:tblHeader/>' : '') +
    (options.exactTwips ? `<w:trHeight w:val="${options.exactTwips}" w:hRule="exact"/>` : '');
  const [keepFirst, keepSecond] = options.keep ?? [false, false];
  const first = options.first ?? para(`${name}c1-`, options.lines ?? 1, { keep: keepFirst });
  return (
    `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}` +
    cell(first, options.firstTcPr) +
    cell(para(`${name}c2-`, 1, { keep: keepSecond })) +
    '</w:tr>'
  );
};

const table = (rows: readonly string[], tblPr = '') =>
  `<w:tbl><w:tblPr>${tblPr}<w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
  `<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${rows.join('')}</w:tbl>`;

const ALL = [true, true] as const;
const FIRST = [true, false] as const;
const LAST = [false, true] as const;
const P8 = para('P', 8);
const TAIL = para('TAIL');
const R4 = row('R4', { lines: 2, cantSplit: true });

/** Every line text of a block, in reading order: rows, then cells, then lines. */
const blockText = (block: BlockFragmentRecord): string[] =>
  block.kind === 'paragraph'
    ? block.lines
        .map((line) =>
          line.spans
            .map((span) => span.text)
            .join('')
            .trim()
        )
        .filter((text) => text !== '')
    : block.rows.flatMap((placed) => placed.cells.flatMap((c) => c.blocks.flatMap(blockText)));
const pages = (layout: SemanticLayout): string[] =>
  layout.pages.map((page) => page.fragments.flatMap(blockText).join(' '));

const P = 'P1 P2 P3 P4 P5 P6 P7 P8';
const R4_TAIL = 'R4c1-1 R4c1-2 R4c2-1 TAIL1';

// Captured probes. Compatibility modes 14 and 15 give the same pages.
const wordProbes: readonly (readonly [string, string, readonly string[]])[] = [
  [
    'a row without keepNext stays',
    P8 + table([row('R1'), row('R2'), row('R3'), R4]) + TAIL,
    [`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1 R3c1-1 R3c2-1`, R4_TAIL],
  ],
  [
    'a row with keepNext in every cell moves with the row that must move',
    P8 + table([row('R1'), row('R2'), row('R3', { keep: ALL }), R4]) + TAIL,
    [`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1`, `R3c1-1 R3c2-1 ${R4_TAIL}`],
  ],
  [
    'keepNext in the first cell alone keeps the row',
    P8 + table([row('R1'), row('R2'), row('R3', { keep: FIRST }), R4]) + TAIL,
    [`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1`, `R3c1-1 R3c2-1 ${R4_TAIL}`],
  ],
  [
    'keepNext in the last cell alone does not keep the row',
    P8 + table([row('R1'), row('R2'), row('R3', { keep: LAST }), R4]) + TAIL,
    [`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1 R3c1-1 R3c2-1`, R4_TAIL],
  ],
  [
    'a splittable next row needs only its opening line',
    P8 + table([row('R1'), row('R2'), row('R3', { keep: ALL }), row('R4', { lines: 2 })]) + TAIL,
    [`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1 R3c1-1 R3c2-1 R4c1-1 R4c2-1`, 'R4c1-2 TAIL1'],
  ],
  [
    'a kept splittable row moves whole rather than splitting',
    P8 + table([row('R1'), row('R3', { lines: 3, keep: ALL }), R4]) + TAIL,
    [`${P} R1c1-1 R1c2-1`, `R3c1-1 R3c1-2 R3c1-3 R3c2-1 ${R4_TAIL}`],
  ],
  [
    'a kept cantSplit row moves whole',
    P8 + table([row('R1'), row('R3', { lines: 3, keep: ALL, cantSplit: true }), R4]) + TAIL,
    [`${P} R1c1-1 R1c2-1`, `R3c1-1 R3c1-2 R3c1-3 R3c2-1 ${R4_TAIL}`],
  ],
  [
    'a kept last row moves with the paragraph after the table',
    P8 +
      table([row('R1'), row('R2'), row('R3', { keep: ALL })]) +
      para('Q', 2, { keepLines: true }) +
      TAIL,
    [`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1`, 'R3c1-1 R3c2-1 Q1 Q2 TAIL1'],
  ],
  [
    'consecutive kept rows move as one group',
    P8 + table([row('R1'), row('R2', { keep: ALL }), row('R3', { keep: ALL }), R4]) + TAIL,
    [`${P} R1c1-1 R1c2-1`, `R2c1-1 R2c2-1 R3c1-1 R3c2-1 ${R4_TAIL}`],
  ],
  [
    'a kept row below header rows moves, and the header repeats above it',
    P8 +
      table([
        row('H', { header: true }),
        row('R1'),
        row('R2', { keep: ALL }),
        row('R3', { lines: 2, cantSplit: true }),
        row('R4'),
      ]) +
      TAIL,
    [
      `${P} Hc1-1 Hc2-1 R1c1-1 R1c2-1`,
      'Hc1-1 Hc2-1 R2c1-1 R2c2-1 R3c1-1 R3c1-2 R3c2-1 R4c1-1 R4c2-1 TAIL1',
    ],
  ],
  [
    'a caption stays when the header and a splittable first row start beside it',
    P8 +
      para('CAP', 1, { keep: true }) +
      table([row('H', { header: true }), row('R1', { lines: 3 }), row('R2')]) +
      TAIL,
    [`${P} CAP1 Hc1-1 Hc2-1 R1c1-1 R1c1-2 R1c2-1`, 'Hc1-1 Hc2-1 R1c1-3 R2c1-1 R2c2-1 TAIL1'],
  ],
  [
    'a caption, the header rows and a kept first row move as one group',
    P8 +
      para('CAP', 1, { keep: true }) +
      table([
        row('H', { header: true }),
        row('R1', { keep: ALL }),
        row('R2', { lines: 3, cantSplit: true }),
      ]) +
      TAIL,
    [P, 'CAP1 Hc1-1 Hc2-1 R1c1-1 R1c2-1 R2c1-1 R2c1-2 R2c1-3 R2c2-1 TAIL1'],
  ],
  [
    'keepNext on the first paragraph of the first cell keeps the row',
    P8 +
      table([row('R1'), row('R3', { first: para('A', 1, { keep: true }) + para('B') }), R4]) +
      TAIL,
    [`${P} R1c1-1 R1c2-1`, `A1 B1 R3c2-1 ${R4_TAIL}`],
  ],
  [
    'keepNext on a later paragraph of the first cell does not keep the row',
    P8 +
      table([row('R1'), row('R3', { first: para('A') + para('B', 1, { keep: true }) }), R4]) +
      TAIL,
    [`${P} R1c1-1 R1c2-1 A1 B1 R3c2-1`, R4_TAIL],
  ],
  [
    'a caption keeps with a table whose first row has no room to start',
    para('P', 11) +
      para('CAP', 1, { keep: true }) +
      table([row('R1', { lines: 2 }), row('R2')]) +
      TAIL,
    ['P1 P2 P3 P4 P5 P6 P7 P8 P9 P10 P11', 'CAP1 R1c1-1 R1c1-2 R1c2-1 R2c1-1 R2c2-1 TAIL1'],
  ],
  [
    'a caption beside a cantSplit first row that fits stays',
    P8 +
      para('CAP', 1, { keep: true }) +
      table([row('R1', { lines: 3, cantSplit: true }), row('R2')]) +
      TAIL,
    [`${P} CAP1 R1c1-1 R1c1-2 R1c1-3 R1c2-1`, 'R2c1-1 R2c2-1 TAIL1'],
  ],
];

// Probes captured in compatibility mode 15 only.
const wordProbes15: readonly (readonly [string, string, readonly string[]])[] = [
  [
    'a kept row moves when widow control keeps the next row from opening in one line',
    P8 +
      table([
        row('R1'),
        row('R2'),
        row('R3', { keep: ALL }),
        row('R4', { first: para('R4c1-', 3, { widow: true }) }),
      ]) +
      TAIL,
    [`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1`, 'R3c1-1 R3c2-1 R4c1-1 R4c1-2 R4c1-3 R4c2-1 TAIL1'],
  ],
  [
    'a kept row moves when the next row opens with a keepLines paragraph',
    P8 +
      table([
        row('R1'),
        row('R2'),
        row('R3', { keep: ALL }),
        row('R4', { first: para('R4c1-', 2, { keepLines: true }) }),
      ]) +
      TAIL,
    [`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1`, `R3c1-1 R3c2-1 ${R4_TAIL}`],
  ],
  [
    'a kept row moves with an exact-height next row',
    P8 +
      table([
        row('R1'),
        row('R2'),
        row('R3', { keep: ALL }),
        row('R4', { lines: 2, exactTwips: 560 }),
      ]) +
      TAIL,
    [`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1`, `R3c1-1 R3c2-1 ${R4_TAIL}`],
  ],
  [
    'seven kept rows move as one group',
    P8 +
      table([
        row('R0'),
        ...Array.from({ length: 7 }, (_, i) => row(`K${i + 1}`, { keep: ALL })),
        R4,
      ]) +
      TAIL,
    [
      `${P} R0c1-1 R0c2-1`,
      Array.from({ length: 7 }, (_, i) => `K${i + 1}c1-1 K${i + 1}c2-1`).join(' ') + ` ${R4_TAIL}`,
    ],
  ],
  [
    'ten kept rows move, although only eight are priced',
    P8 +
      table([
        row('R0'),
        ...Array.from({ length: 10 }, (_, i) => row(`K${i + 1}`, { keep: ALL })),
        R4,
      ]) +
      TAIL,
    [
      `${P} R0c1-1 R0c2-1`,
      Array.from({ length: 10 }, (_, i) => `K${i + 1}c1-1 K${i + 1}c2-1`).join(' ') +
        ' R4c1-1 R4c1-2 R4c2-1',
      'TAIL1',
    ],
  ],
  [
    'a kept group that cannot fit any page still starts on the next page',
    P8 +
      table([
        row('R0'),
        ...Array.from({ length: 12 }, (_, i) => row(`K${i + 1}`, { keep: ALL })),
        R4,
      ]) +
      TAIL,
    [
      `${P} R0c1-1 R0c2-1`,
      Array.from({ length: 12 }, (_, i) => `K${i + 1}c1-1 K${i + 1}c2-1`).join(' '),
      R4_TAIL,
    ],
  ],
  [
    'a kept row on a continuation page moves below the repeated header rows',
    P8 +
      table([
        row('H', { header: true }),
        ...Array.from({ length: 12 }, (_, i) => row(`R${i + 1}`)),
        row('R13', { keep: ALL }),
        row('R14', { lines: 2, cantSplit: true }),
      ]) +
      TAIL,
    [
      `${P} Hc1-1 Hc2-1 R1c1-1 R1c2-1 R2c1-1 R2c2-1 R3c1-1 R3c2-1`,
      'Hc1-1 Hc2-1 ' + Array.from({ length: 9 }, (_, i) => `R${i + 4}c1-1 R${i + 4}c2-1`).join(' '),
      'Hc1-1 Hc2-1 R13c1-1 R13c2-1 R14c1-1 R14c1-2 R14c2-1 TAIL1',
    ],
  ],
  [
    'a kept last row stays when the paragraph after it may split',
    P8 + table([row('R1'), row('R2'), row('R3', { keep: ALL })]) + para('Q', 3) + TAIL,
    [`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1 R3c1-1 R3c2-1 Q1`, 'Q2 Q3 TAIL1'],
  ],
  [
    'header rows move with a cantSplit first row, and the caption with them',
    P8 +
      para('CAP', 1, { keep: true }) +
      table([row('H', { header: true }), row('R1', { lines: 3, cantSplit: true }), row('R2')]) +
      TAIL,
    [P, 'CAP1 Hc1-1 Hc2-1 R1c1-1 R1c1-2 R1c1-3 R1c2-1 R2c1-1 R2c2-1 TAIL1'],
  ],
  [
    'header rows move when the first row has no room to start, and the caption with them',
    para('P', 10) +
      para('CAP', 1, { keep: true }) +
      table([row('H', { header: true }), row('R1', { lines: 2 }), row('R2')]) +
      TAIL,
    ['P1 P2 P3 P4 P5 P6 P7 P8 P9 P10', 'CAP1 Hc1-1 Hc2-1 R1c1-1 R1c1-2 R1c2-1 R2c1-1 R2c2-1 TAIL1'],
  ],
];

describe('table row keep-with-next, compatibility mode 15 only', () => {
  for (const [name, body, expected] of wordProbes15) {
    test(name, () => {
      expect(pages(lay(load(body), 15))).toEqual([...expected]);
    });
  }

  test('in compatibility mode 14, widow control does not stop the next row opening', () => {
    const body =
      P8 +
      table([
        row('R1'),
        row('R2'),
        row('R3', { keep: ALL }),
        row('R4', { first: para('R4c1-', 3, { widow: true }) }),
      ]) +
      TAIL;
    expect(pages(lay(load(body), 14))).toEqual([
      `${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1 R3c1-1 R3c2-1 R4c1-1 R4c2-1`,
      'R4c1-2 R4c1-3 TAIL1',
    ]);
  });
});

for (const mode of [15, 14]) {
  describe(`table row keep-with-next, compatibility mode ${mode}`, () => {
    for (const [name, body, expected] of wordProbes) {
      test(name, () => {
        expect(pages(lay(load(body), mode))).toEqual([...expected]);
      });
    }
  });
}

describe('a kept first row below header rows', () => {
  test('moves the header rows with it rather than leaving them alone', () => {
    const body =
      P8 +
      table([
        row('H', { header: true }),
        row('R1', { keep: ALL }),
        row('R2', { lines: 3, cantSplit: true }),
      ]) +
      TAIL;
    expect(pages(lay(load(body)))).toEqual([
      P,
      'Hc1-1 Hc2-1 R1c1-1 R1c2-1 R2c1-1 R2c1-2 R2c1-3 R2c2-1 TAIL1',
    ]);
  });
});

describe('the property that keeps a row', () => {
  const kept = [`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1`, `R3c1-1 R3c2-1 ${R4_TAIL}`];
  const stays = [`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1 R3c1-1 R3c2-1`, R4_TAIL];
  const withFirst = (first: string, tblPr = '') =>
    P8 + table([row('R1'), row('R2'), row('R3', { first }), R4], tblPr) + TAIL;

  test('keepNext inherited through the paragraph style chain keeps the row', () => {
    expect(pages(lay(load(withFirst(para('R3c1-', 1, { style: 'Kept' })))))).toEqual(kept);
  });

  test('an explicit keepNext off overrides the style', () => {
    const first = para('R3c1-', 1, { style: 'Kept', keep: 'off' });
    expect(pages(lay(load(withFirst(first))))).toEqual(stays);
  });

  test('keepNext from the table style keeps every row that has room to', () => {
    // Every row keeps, so R1 to R3 and R4 form one group that fits a fresh page.
    const body = withFirst(para('R3c1-'), '<w:tblStyle w:val="KeepTable"/>');
    expect(pages(lay(load(body)))).toEqual([
      P,
      `R1c1-1 R1c2-1 R2c1-1 R2c2-1 R3c1-1 R3c2-1 ${R4_TAIL}`,
    ]);
  });

  test('a first cell that opens with a nested table does not keep the row', () => {
    const nested =
      '<w:tbl><w:tblPr><w:tblW w:w="2800" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="2800"/></w:tblGrid>' +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="2800" w:type="dxa"/></w:tcPr>${para('N', 1, { keep: true })}</w:tc></w:tr></w:tbl>`;
    expect(pages(lay(load(withFirst(nested + para('R3c1-')))))[0]).toContain('R3c1-1');
  });

  test('a positioned table ignores row keeps', () => {
    const body =
      P8 +
      table(
        [row('R1'), row('R2'), row('R3', { keep: ALL }), R4],
        '<w:tblpPr w:vertAnchor="text" w:horzAnchor="margin" w:tblpY="1"/>'
      ) +
      TAIL;
    const withoutKeep = body.replace(/<w:keepNext\/>/g, '');
    expect(pages(lay(load(body)))).toEqual(pages(lay(load(withoutKeep))));
  });
});

describe('unsupported shapes place by the ordinary row rules', () => {
  const plain = (body: string) => pages(lay(load(body.replace(/<w:keepNext\/>/g, ''))));

  test('a kept row whose successor continues a vertical merge', () => {
    const body =
      P8 +
      table([
        row('R1'),
        row('R2'),
        row('R3', { keep: ALL, firstTcPr: '<w:vMerge w:val="restart"/>' }),
        row('R4', { lines: 1, cantSplit: true, firstTcPr: '<w:vMerge/>' }),
      ]) +
      TAIL;
    expect(pages(lay(load(body)))).toEqual(plain(body));
  });

  test('a kept last row with nothing after the table does not move', () => {
    const body = P8 + table([row('R1'), row('R2'), row('R3'), row('R4', { keep: ALL })]);
    expect(pages(lay(load(body)))).toEqual([
      `${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1 R3c1-1 R3c2-1 R4c1-1 R4c2-1`,
    ]);
  });

  test('every source line is placed exactly once', () => {
    const kept = Array.from({ length: 12 }, (_, i) => row(`K${i + 1}`, { keep: ALL }));
    const layout = lay(load(P8 + table([row('R0'), ...kept, R4]) + TAIL));
    const words = pages(layout).join(' ').split(' ');
    expect(new Set(words).size).toBe(words.length);
    expect(words.length).toBe(8 + 2 + 24 + 3 + 1);
  });
});

describe('kept group pricing', () => {
  const rows = Array.from(
    { length: 12 },
    (_, i) => ({ id: `r${i}`, cells: [] }) as unknown as SemanticTableRow
  );
  const source = (keeps: readonly number[], extra: Partial<KeptRowSource> = {}): KeptRowSource => ({
    rows,
    keepsAt: (index) => keeps.includes(index),
    heightOf: () => 14,
    placesWhole: () => false,
    openingOf: () => 7,
    following: () => 20,
    ...extra,
  });

  test('prices the kept rows whole and the next row at its opening', () => {
    expect(keptRowGroup(source([2, 3]), 2)).toEqual({ end: 3, kept: 28, successor: 7 });
  });

  test('prices a next row that must place whole at its full height', () => {
    const group = keptRowGroup(source([2], { placesWhole: () => true }), 2);
    expect(group).toEqual({ end: 2, kept: 14, successor: 14 });
  });

  test('prices the content after the table for a kept last row', () => {
    expect(keptRowGroup(source([11]), 11)).toEqual({ end: 11, kept: 14, successor: 20 });
    expect(keptRowGroup(source([11], { following: () => undefined }), 11)).toBeNull();
    expect(keptRowGroup(source([11], { following: () => null }), 11)).toBeNull();
  });

  test('prices only at the head of a group', () => {
    expect(keptRowGroup(source([2, 3]), 3)).toBeNull();
    expect(keptRowGroup(source([2]), 1)).toBeNull();
  });

  test('prices at most eight kept rows, as a lower bound without a successor', () => {
    expect(keptRowGroup(source([0, 1, 2, 3, 4, 5, 6, 7]), 0)).toEqual({
      end: 7,
      kept: 112,
      successor: 7,
    });
    expect(keptRowGroup(source([0, 1, 2, 3, 4, 5, 6, 7, 8]), 0)).toEqual({
      end: 7,
      kept: 112,
      successor: 0,
      truncated: true,
    });
  });

  test('prices a next row that fits the room whole without searching its opening', () => {
    let searched = 0;
    const counting = source([2], { openingOf: () => (searched += 1) });
    expect(keptRowGroup(counting, 2, 28)).toEqual({ end: 2, kept: 14, successor: 14 });
    expect(searched).toBe(0);
    expect(keptRowGroup(counting, 2, 20)).toEqual({ end: 2, kept: 14, successor: 1 });
  });

  test('finds the smallest opening height', () => {
    expect(smallestOpening(40, (height) => height >= 14)).toBeCloseTo(14, 2);
    expect(smallestOpening(40, () => false)).toBe(40);
    expect(smallestOpening(0, () => true)).toBe(0);
  });
});

describe('edits, save and reopen', () => {
  const bodyOf = (part: OoxmlPart) => {
    const body = part.root.children.find((child) => child.kind === 'body');
    if (body?.kind !== 'body') throw new Error('The fixture has no body.');
    return body;
  };

  test('changing the paragraph after a kept last row re-places the row', () => {
    const store = new TreeDocumentStore(
      load(P8 + table([row('R1'), row('R2'), row('R3', { keep: ALL })]) + para('Q', 2) + TAIL)
    );
    const session = createLayoutSession();
    const extra = { session };
    const first = lay(store.part, 15, extra);
    // Q may split, so its first line fits beside R3.
    expect(pages(first)[0]).toContain('R3c1-1');
    const q = bodyOf(store.part).children.find(
      (child) => child.kind === 'paragraph' && JSON.stringify(child).includes('Q1')
    );
    if (!q) throw new Error('The fixture has no Q.');
    const result = store.transact((tx) => {
      tx.apply({
        op: 'setParagraphProperties',
        paragraphId: q.id,
        properties: [{ localName: 'keepLines', attributes: {} }],
      });
    });
    expect(result.ok).toBe(true);
    const retained = layoutSemanticDocument(store.part, 2, {
      measurer,
      styleCascade,
      compatibilityMode: 15,
      session,
    });
    const cold = lay(structuredClone(store.part), 15);
    expect(pages(retained)).toEqual(pages(cold));
    expect(pages(cold)[1]).toStartWith('R3c1-1');
  });

  test('a saved and reopened document keeps the row group together', () => {
    const part = load(P8 + table([row('R1'), row('R2'), row('R3', { keep: ALL }), R4]) + TAIL);
    const reopened = read(serializeOoxmlPart(part), '/word/document.xml');
    expect(pages(lay(reopened))).toEqual(pages(lay(part)));
    expect(pages(lay(reopened))[1]).toStartWith('R3c1-1');
  });
});

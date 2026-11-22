// A table restart keeps the pages before its page only when every row a decision for those
// pages read is unchanged (`table-read-horizon.ts`). The row that opens a page moved there
// because of the row after it: a row that ends a page closes it with the table's bottom rule,
// and with a thick compound rule that row fits only when the next row follows it. So an edit
// to the row after a page-opening row can pull that row back onto the page above.

import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import type { TreeDocOp } from '../../store/store/tree-op-types.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { tablePageRestartTestRecorder } from '../table-page-restart.ts';
import { load, read, W } from './table-row-keep-fixtures.ts';

const styleCascade = buildStyleCascadeTable(
  read(
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      `<w:name w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:style></w:styles>`,
    '/word/styles.xml'
  ).root
);
const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart, extra: object = {}) =>
  layoutSemanticDocument(part, 1, { measurer, styleCascade, compatibilityMode: 15, ...extra });

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (content: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
const rule = (edge: string) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`;
const BORDERS =
  `<w:tblBorders>${['top', 'left', 'right', 'insideV'].map(rule).join('')}` +
  `<w:bottom w:val="thickThinLargeGap" w:sz="96" w:space="0" w:color="000000"/>${rule('insideH')}` +
  `</w:tblBorders>`;

/** Exact-height, `w:cantSplit`, and plain rows, in an order `seed` shifts. */
function row(r: number, seed: number): string {
  const kind = (r * 7 + seed) % 5;
  const trPr =
    kind === 0
      ? `<w:trPr><w:trHeight w:val="${600 + 200 * (r % 4)}" w:hRule="exact"/></w:trPr>`
      : kind === 1
        ? '<w:trPr><w:cantSplit/></w:trPr>'
        : '';
  const first =
    kind === 1
      ? `<w:p><w:r><w:t>C${r}</w:t><w:br/><w:t>x</w:t><w:br/><w:t>y</w:t></w:r></w:p>`
      : p(`R${r}`);
  return `<w:tr>${trPr}${tc(first)}${tc(p(`S${r}`))}</w:tr>`;
}

function body(seed: number, before: number): string {
  return (
    Array.from({ length: before }, (_, i) => p(`P${i}`)).join('') +
    `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblLayout w:type="fixed"/>${BORDERS}</w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
    `${Array.from({ length: 40 }, (_, r) => row(r, seed)).join('')}</w:tbl>` +
    p('After')
  );
}

const elements = (node: OoxmlNode, kind: string): OoxmlElement[] =>
  node.kind === 'element' || 'children' in node
    ? ((node as OoxmlElement).children.filter((child) => child.kind === kind) as OoxmlElement[])
    : [];

test('an edit to the row after a page-opening row lays out as the whole table again', () => {
  let cases = 0;
  let restarts = 0;
  const mismatches: string[] = [];
  // Seeds and leading paragraphs the reviewer's sweep found differences with.
  for (const [seed, before] of [
    [0, 0],
    [0, 1],
    [1, 3],
    [2, 5],
    [3, 2],
    [4, 7],
  ] as const) {
    const base = load(body(seed, before));
    const openers = lay(base)
      .pages.flatMap((page) => page.fragments.filter((fragment) => fragment.kind === 'table'))
      .slice(1)
      .map(
        (fragment) => fragment.kind === 'table' && fragment.rows.find((r) => !r.isHeaderRepeat)?.id
      )
      .filter((id): id is string => typeof id === 'string');
    for (const opener of openers)
      for (const edit of ['height', 'delete', 'insert', 'before'] as const) {
        const session = createLayoutSession();
        const cache = createParagraphLayoutCache();
        lay(base, { session, cache });
        const table = elements(elements(base.root, 'body')[0]!, 'table')[0]!;
        const rows = elements(table, 'tableRow');
        const at = rows.findIndex((r) => r.id === opener);
        const next = rows[at + 1];
        const previous = rows[at - 1];
        if (!next || !previous) continue;
        const op: TreeDocOp =
          edit === 'height'
            ? { op: 'setTableRowHeight', tableId: table.id, rowId: next.id, heightTwips: 200 }
            : edit === 'delete'
              ? { op: 'deleteTableRow', tableId: table.id, rowId: next.id }
              : edit === 'insert'
                ? { op: 'insertTableRow', tableId: table.id, rowId: opener, where: 'below' }
                : {
                    op: 'setTableRowHeight',
                    tableId: table.id,
                    rowId: previous.id,
                    heightTwips: 200,
                  };
        const applied = applyTreeOp(base, op);
        if (!applied.ok) continue;
        const recorder = tablePageRestartTestRecorder();
        const incremental = lay(applied.part, { session, cache });
        recorder.dispose();
        cases += 1;
        restarts += recorder.restarts;
        if (JSON.stringify(incremental.pages) !== JSON.stringify(lay(applied.part).pages))
          mismatches.push(`seed ${seed}, ${before} before, row ${at}, ${edit}`);
      }
  }
  expect(mismatches).toEqual([]);
  // The sweep must still exercise restarts, not refuse them all.
  expect(cases).toBeGreaterThan(100);
  expect(restarts).toBeGreaterThan(cases / 2);
}, 60_000);

test('a restart opens its page with the heights the row had where it stood before', () => {
  // The repeat admission at a page opening reads the opening row's height as measured on the
  // page above, below the thick top rule's narrower inside rule. Measured again at the new
  // page top, the tall `w:cantSplit` row no longer fits below the repeat.
  const lines = (count: number) =>
    `<w:p><w:r>${Array.from({ length: count }, (_, i) => `<w:t>T-${i}</w:t>`).join('<w:br/>')}</w:r></w:p>`;
  const cell = (content: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
  const plain = (r: number) =>
    `<w:tr>${cell(p(`R${r}a`))}${cell(p(`R${r}b`))}${cell(p(`R${r}c`))}</w:tr>`;
  const borders =
    `<w:tblBorders><w:top w:val="thickThinLargeGap" w:sz="96" w:space="0" w:color="000000"/>` +
    `${['left', 'right', 'insideV', 'insideH', 'bottom'].map(rule).join('')}</w:tblBorders>`;
  const rowsXml = [
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell(p('Head A'))}${cell(p('Head B'))}${cell(p('Head C'))}</w:tr>`,
    ...Array.from({ length: 7 }, (_, r) => plain(r)),
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(lines(9))}${cell(p('t'))}${cell(p('u'))}</w:tr>`,
    plain(20),
    plain(21),
    plain(22),
  ];
  const base = load(
    p('Pre') +
      `<w:tbl><w:tblPr><w:tblW w:w="6000" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borders}</w:tblPr>` +
      `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(3)}</w:tblGrid>${rowsXml.join('')}</w:tbl>`
  );
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  lay(base, { session, cache });
  const table = elements(elements(base.root, 'body')[0]!, 'table')[0]!;
  const applied = applyTreeOp(base, {
    op: 'insertTableRow',
    tableId: table.id,
    rowId: elements(table, 'tableRow').at(-1)!.id,
    where: 'below',
  });
  if (!applied.ok) throw new Error(applied.reason);
  const recorder = tablePageRestartTestRecorder();
  const incremental = lay(applied.part, { session, cache });
  recorder.dispose();
  expect(recorder.restarts).toBe(1);
  expect(recorder.fallbacks).toBe(0);
  expect(JSON.stringify(incremental.pages)).toBe(JSON.stringify(lay(applied.part).pages));
});

// A table restart that the paginator refuses, or that throws, gives the flow back to the point
// before the table and paginates the whole table, so an edit never fails where a whole
// pagination succeeds. The cell break key list stays bounded across many restarts.

import { afterEach, expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import type { TreeDocOp } from '../../store/store/tree-op-types.ts';
import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { tablePageRestartTestRecorder } from '../table-page-restart.ts';
import { failTableRestartsForTests } from '../table-restart-pass.ts';
import { tableCellBreakKeyCount, tableCellBreakKeysOf } from '../table-cell-break-keys.ts';
import { load, read, W } from './table-row-keep-fixtures.ts';

const styleCascade = buildStyleCascadeTable(
  read(
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
      `<w:name w:val="Normal"/><w:pPr><w:spacing w:before="120" w:after="0"/></w:pPr></w:style></w:styles>`,
    '/word/styles.xml'
  ).root
);
const measurer = createFixedMeasurer(6, 14);
const lay = (part: OoxmlPart, extra: object = {}) =>
  layoutSemanticDocument(part, 1, { measurer, styleCascade, compatibilityMode: 15, ...extra });

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const tc = (text: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;
const row = (r: number, header = false) =>
  `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${tc(`R${r}a`)}${tc(`R${r}b`)}</w:tr>`;
const table = (rows: number) =>
  `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
  `${row(-1, true)}${Array.from({ length: rows }, (_, r) => row(r)).join('')}</w:tbl>`;

const elements = (node: OoxmlElement, kind: string): OoxmlElement[] =>
  node.children.filter((child): child is OoxmlElement => child.kind === kind);
const tableOf = (part: OoxmlPart) => elements(elements(part.root, 'body')[0]!, 'table')[0]!;
const insertBelow = (part: OoxmlPart, at: number): TreeDocOp => ({
  op: 'insertTableRow',
  tableId: tableOf(part).id,
  rowId: elements(tableOf(part), 'tableRow')[at]!.id,
  where: 'below',
});

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

for (const how of ['throw', 'refuse'] as const)
  for (const [where, body] of [
    ['after a paragraph', p('Before') + table(80) + p('After')],
    ['as the first block', table(80) + p('After')],
  ] as const)
    test(`a restart that fails (${how}) ${where} paginates the whole table`, () => {
      let part = load(body);
      const session = createLayoutSession();
      const cache = createParagraphLayoutCache();
      lay(part, { session, cache });
      restore = failTableRestartsForTests(how);
      const recorder = tablePageRestartTestRecorder();
      for (const at of [60, 40, 20]) {
        const applied = applyTreeOp(part, insertBelow(part, at));
        expect(applied.ok).toBe(true);
        if (!applied.ok) return;
        part = applied.part;
        expect(JSON.stringify(lay(part, { session, cache }).pages)).toBe(
          JSON.stringify(lay(part).pages)
        );
      }
      recorder.dispose();
      expect(recorder.restarts).toBe(3);
      expect(recorder.fallbacks).toBe(how === 'throw' ? 3 : 0);
      // After the fallback, the next edit restarts again.
      restore();
      restore = undefined;
      const after = tablePageRestartTestRecorder();
      const applied = applyTreeOp(part, insertBelow(part, 50));
      if (!applied.ok) throw new Error('refused');
      part = applied.part;
      expect(JSON.stringify(lay(part, { session, cache }).pages)).toBe(
        JSON.stringify(lay(part).pages)
      );
      after.dispose();
      expect(after.restarts).toBe(1);
    });

test('the cell break key list stays bounded across restarts after a text update', () => {
  let part = load(p('Before') + table(300));
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  lay(part, { session, cache });
  const apply = (op: TreeDocOp) => {
    const applied = applyTreeOp(part, op);
    if (!applied.ok) throw new Error('refused');
    part = applied.part;
    lay(part, { session, cache });
  };
  const recorder = tablePageRestartTestRecorder();
  // A text update on an early page, then many restarts after it.
  const typed = elements(
    elements(elements(tableOf(part), 'tableRow')[3]!, 'tableCell')[0]!,
    'paragraph'
  )[0]!;
  apply({ op: 'insertText', paragraphId: typed.id, offset: 0, text: 'x' });
  const lengths: number[] = [];
  for (let step = 0; step < 40; step += 1) {
    apply(insertBelow(part, 150));
    lengths.push(tableCellBreakKeyCount(tableOf(part)));
  }
  recorder.dispose();
  expect(recorder.restarts).toBeGreaterThan(30);
  const kept = new Set(tableCellBreakKeysOf(tableOf(part)));
  // Every key a whole pagination records is still named.
  lay(part, { session: createLayoutSession(), cache: createParagraphLayoutCache() });
  const fresh = tableCellBreakKeysOf(tableOf(part)) ?? [];
  expect(fresh.filter((key) => !kept.has(key))).toEqual([]);
  // The list grows with the rows inserted, not with the restarts.
  expect(lengths.at(-1)!).toBeLessThan(fresh.length * 1.5);
  expect(lengths.at(-1)! - lengths[0]!).toBeLessThan(40 * 10);
});

test('a restart that throws says so once on the console, without document content', () => {
  let part = load(p('Before') + table(80) + p('After'));
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  lay(part, { session, cache });
  restore = failTableRestartsForTests('throw');
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '));
  try {
    for (const at of [60, 40]) {
      const applied = applyTreeOp(part, insertBelow(part, at));
      if (!applied.ok) throw new Error('refused');
      part = applied.part;
      lay(part, { session, cache });
    }
  } finally {
    console.warn = warn;
  }
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('paginated the whole table instead: Error.');
  expect(warnings[0]).not.toContain('document.xml');
});

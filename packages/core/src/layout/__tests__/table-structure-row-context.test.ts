// The rows of a long table are reused across structure reads under a context per table
// (`table-structure-rows.ts`). Many long tables with one style must not evict each other's
// contexts: an edit to any of them reuses its unchanged rows.

import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import type { OoxmlElement, OoxmlPart } from '@docx-editor.dev/core/store';
import { readTableStructure } from '../semantic-table.ts';
import { tableRowReuseTestRecorder } from '../table-structure-rows.ts';
import { load } from './table-row-keep-fixtures.ts';

const TABLES = 8;
const ROWS = 120;
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const tc = (text: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;
const table = (t: number) =>
  `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
  Array.from(
    { length: ROWS },
    (_, r) => `<w:tr>${tc(`T${t}R${r}a`)}${tc(`T${t}R${r}b`)}</w:tr>`
  ).join('') +
  `</w:tbl>${p(`After ${t}`)}`;

const tablesOf = (part: OoxmlPart): OoxmlElement[] => {
  const body = part.root.children.find((child) => child.kind === 'body') as OoxmlElement;
  return body.children.filter((child): child is OoxmlElement => child.kind === 'table');
};
const readAll = (part: OoxmlPart) => {
  for (const node of tablesOf(part)) readTableStructure(node, 400, 0, undefined, 'all-markup');
};

test('each of many long tables with one style reuses its rows after an edit', () => {
  let part = load(Array.from({ length: TABLES }, (_, t) => table(t)).join(''));
  readAll(part);
  for (let t = 0; t < TABLES; t += 1) {
    const node = tablesOf(part)[t]!;
    const row = node.children.filter((child) => child.kind === 'tableRow')[60]!;
    const applied = applyTreeOp(part, {
      op: 'setTableRowHeight',
      tableId: node.id,
      rowId: row.id,
      heightTwips: 600,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    part = applied.part;
    const recorder = tableRowReuseTestRecorder();
    readTableStructure(tablesOf(part)[t]!, 400, 0, undefined, 'all-markup');
    recorder.dispose();
    // Every row but the edited one comes back by identity.
    expect(recorder.reusedRows).toBe(ROWS - 1);
  }
});

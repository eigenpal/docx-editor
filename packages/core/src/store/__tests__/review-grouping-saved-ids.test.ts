// Review grouping that does not depend on a shared `@w:id`. A saved file gives every revision
// its own id, so the decisions the open document shows must come from structure.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '../package/ooxml-tree.ts';
import { revisionItemsOf } from '../store/review-reads.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const AT = 'w:author="A" w:date="2024-01-01T10:00:00Z"';

function cards(body: string) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return revisionItemsOf(read.part).map((item) => ({
    kind: item.revisionKind,
    changes: item.structuralChanges ?? [],
    text: item.text,
    ranges: item.ranges.length,
  }));
}

const bold = (id: number) =>
  `<w:rPr><w:b/><w:rPrChange w:id="${id}" ${AT}><w:rPr/></w:rPrChange></w:rPr>`;
const boldRun = (id: number, text: string) => `<w:r>${bold(id)}<w:t>${text}</w:t></w:r>`;

test('run formatting with one id reads as one decision per paragraph and per mark', () => {
  const body =
    `<w:p><w:pPr>${bold(1)}</w:pPr>${boldRun(1, 'one')}${boldRun(1, 'two')}</w:p>` +
    `<w:p>${boldRun(1, 'three')}</w:p>`;
  expect(cards(body).map((card) => card.ranges)).toEqual([1, 2, 1]);
});

test('the same formatting with separate ids reads as the same decisions', () => {
  const body =
    `<w:p><w:pPr>${bold(1)}</w:pPr>${boldRun(2, 'one')}${boldRun(3, 'two')}</w:p>` +
    `<w:p>${boldRun(4, 'three')}</w:p>`;
  expect(cards(body).map((card) => card.ranges)).toEqual([1, 2, 1]);
});

function insertedRows(shared: boolean): string {
  let id = 10;
  const next = () => (shared ? 10 : id++);
  const cell = (text: string, record: number) =>
    `<w:tc><w:tcPr><w:cellIns w:id="${record}" ${AT}/></w:tcPr>` +
    `<w:p><w:ins w:id="${next()}" ${AT}><w:r><w:t>${text}</w:t></w:r></w:ins></w:p></w:tc>`;
  const row = (a: string, b: string) => {
    const marker = next();
    return `<w:tr><w:trPr><w:ins w:id="${marker}" ${AT}/></w:trPr>${cell(a, shared ? marker : next())}${cell(b, shared ? marker : next())}</w:tr>`;
  };
  return (
    '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
    `<w:tr><w:tc><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr>${row('c', 'd')}${row('e', 'f')}</w:tbl><w:p/>`
  );
}

test('inserted rows with cell records are one decision, with or without a shared id', () => {
  const expected = [
    { kind: 'structural', changes: ['rowInsert', 'cellInsert'], text: 'c\nd\ne\nf', ranges: 4 },
  ];
  expect(cards(insertedRows(false))).toEqual(expected);
  expect(cards(insertedRows(true))).toEqual(expected);
});

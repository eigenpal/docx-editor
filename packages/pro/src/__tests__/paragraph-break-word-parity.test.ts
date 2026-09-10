/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { createT, en } from '@docx-editor.dev/i18n';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { revisionItemLabel } from '../react/review-labels.ts';
import { revisionItemLabel as vueRevisionItemLabel } from '../vue/review-labels.ts';
import { reviewModule as testReviewModule } from '../review/review-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
interface DocxParts {
  readonly body: string;
}
function docx({ body }: DocxParts): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

/** The story's first paragraph id. */
function paragraphIdOf(editor: DocxEditorInstance): string {
  const fragment = editor.surface!.layout().pages[0]!.fragments[0]!;
  if (fragment.kind !== 'paragraph') throw new Error('expected a paragraph fragment');
  return fragment.paragraphId;
}

function mount(parts: DocxParts): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: docx(parts),
    author: 'Grace Hopper',
    modules: [testReviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

test('review: grouped breaks survive save/reopen and accept/reject as a group', async () => {
  for (const action of ['acceptReviewItem', 'rejectReviewItem'] as const) {
    const editor = mount({ body: '<w:p/>' });
    editor.setEditingMode('suggesting');
    const id = paragraphIdOf(editor);
    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 0 },
      head: { paragraphId: id, offset: 0 },
    });
    for (let i = 0; i < 4; i++) editor.surface!.splitParagraph();
    expect(editor.surface!.session.paragraphIds()).toHaveLength(5);
    const bytes = await editor.save();
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: bytes,
      author: 'Grace Hopper',
      modules: [testReviewModule()],
    });
    const marks = reopened
      .getReviewItems()
      .filter((x) => x.kind === 'revision' && x.revisionKind === 'paragraphMark');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.kind === 'revision' && marks[0]!.item.ranges.length).toBe(4);
    expect(reopened[action](marks[0]!.key).ok).toBe(true);
    expect(reopened.surface!.session.paragraphIds()).toHaveLength(
      action === 'acceptReviewItem' ? 5 : 1
    );
    expect(reopened.getReviewItems()).toHaveLength(0);
    reopened.destroy();
    editor.destroy();
  }
});

test('review: opening a document with an initial tracked blank paragraph keeps pilcrows hidden', () => {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    modules: [testReviewModule()],
    document: docx({
      body: '<w:p><w:pPr><w:rPr><w:ins w:id="1" w:author="Reviewer" w:date="2026-09-09T08:00:00Z"/></w:rPr></w:pPr></w:p><w:p/>',
    }),
  });
  // No review card was selected by the user.
  expect(container.querySelector('.docx-show-paragraph-marks')).toBeNull();
  editor.destroy();
});

// Synthetic fixture. No customer document or metadata is needed for this regression.
const stamp = 'w:author="Ada" w:date="2026-01-02T03:04:05Z"';
const insertedMark = (id: number) => `<w:pPr><w:rPr><w:ins w:id="${id}" ${stamp}/></w:rPr></w:pPr>`;
const languageChange = `<w:pPr><w:rPr><w:lang w:val="sv-SE"/><w:rPrChange w:id="4" ${stamp}><w:rPr/></w:rPrChange></w:rPr></w:pPr>`;
const mixedInsertion = `<w:p>${insertedMark(0)}</w:p><w:p>${insertedMark(1)}<w:ins w:id="2" ${stamp}><w:r><w:t>Example</w:t></w:r></w:ins></w:p><w:p>${insertedMark(3)}</w:p><w:p>${languageChange}</w:p>`;

for (const action of ['acceptReviewItem', 'rejectReviewItem'] as const) {
  test(`Word parity: ${action} resolves text and breaks together and preserves the language revision`, async () => {
    const editor = mount({ body: mixedInsertion });
    const bytes = await editor.save();
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: bytes,
      modules: [testReviewModule()],
    });
    expect(reopened.getReviewItems()).toHaveLength(2);
    const insertion = reopened
      .getReviewItems()
      .find((entry) => entry.kind === 'revision' && entry.revisionKind === 'insert');
    expect(insertion?.kind).toBe('revision');
    if (!insertion || insertion.kind !== 'revision') throw new Error('missing insertion');
    expect(insertion.item.addresses).toHaveLength(4);
    expect(insertion.item.text).toBe('\nExample\n\n');
    expect(reopened[action](insertion.key).ok).toBe(true);
    expect(reopened.surface!.session.paragraphIds()).toHaveLength(
      action === 'acceptReviewItem' ? 4 : 1
    );
    expect(reopened.surface!.session.bodyText()).toBe(
      action === 'acceptReviewItem' ? '\nExample\n\n' : ''
    );
    const remaining = reopened.getReviewItems();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.kind === 'revision' && remaining[0]!.item.formattingLanguages).toEqual([
      'sv-SE',
    ]);
    const format = remaining[0]!;
    if (format.kind !== 'revision') throw new Error('missing formatting revision');
    const translate = (key: string) => (key === '_lang' ? 'en' : 'Formatted');
    expect(revisionItemLabel(format.item, translate)).toBe('Formatted: Swedish');
    expect(vueRevisionItemLabel(format.item, translate)).toBe('Formatted: Swedish');
    expect(reopened[action](remaining[0]!.key).ok).toBe(true);
    expect(reopened.getReviewItems()).toHaveLength(0);
    expect(serializeOoxmlPart(reopened.surface!.session.part()).includes('sv-SE')).toBe(
      action === 'acceptReviewItem'
    );
    reopened.destroy();
    editor.destroy();
  });
}

for (const separator of [
  '<w:p><w:r><w:t>unchanged</w:t></w:r></w:p>',
  '<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>',
]) {
  test('Word parity: paragraph grouping does not cross untracked content or tables', () => {
    const editor = mount({
      body: `<w:p>${insertedMark(0)}</w:p>${separator}<w:p>${insertedMark(1)}</w:p><w:p/>`,
    });
    expect(editor.getReviewItems()).toHaveLength(2);
    editor.destroy();
  });
}

test('Word parity: paragraph grouping does not cross authors or table cells', () => {
  const editor = mount({
    body: `<w:p>${insertedMark(0)}</w:p><w:p>${insertedMark(1).replace('Ada', 'Grace')}</w:p><w:p/><w:tbl><w:tr><w:tc><w:p>${insertedMark(5)}</w:p></w:tc><w:tc><w:p>${insertedMark(6)}</w:p></w:tc></w:tr></w:tbl>`,
  });
  expect(editor.getReviewItems()).toHaveLength(4);
  editor.destroy();
});

test('different formatting kinds with the same revision address remain independently reachable', () => {
  const editor = mount({
    body: `<w:p><w:pPr><w:jc w:val="center"/><w:pPrChange w:id="8" ${stamp}><w:pPr/></w:pPrChange></w:pPr><w:r><w:rPr><w:b/><w:rPrChange w:id="8" ${stamp}><w:rPr/></w:rPrChange></w:rPr><w:t>Example</w:t></w:r></w:p>`,
  });
  const items = editor.getReviewItems();
  expect(items).toHaveLength(2);
  expect(new Set(items.map((item) => item.key)).size).toBe(2);
  expect(editor.acceptReviewItem(items[0]!.key).ok).toBe(true);
  const remaining = editor.getReviewItems();
  expect(remaining).toHaveLength(1);
  expect(remaining[0]!.key).toBe(items[1]!.key);
  expect(editor.rejectReviewItem(remaining[0]!.key).ok).toBe(true);
  expect(editor.getReviewItems()).toHaveLength(0);
  editor.destroy();
});

test('formatting cards describe changed values and omit unchanged properties', () => {
  const editor = mount({
    body: `<w:p><w:r><w:rPr><w:b/><w:i w:val="0"/><w:sz w:val="28"/><w:lang w:val="sv-SE"/><w:rPrChange w:id="9" ${stamp}><w:rPr><w:i/><w:sz w:val="24"/><w:lang w:val="en-US"/></w:rPr></w:rPrChange></w:rPr><w:t>Example</w:t></w:r></w:p>`,
  });
  const card = editor.getReviewItems()[0]!;
  if (card.kind !== 'revision') throw new Error('expected formatting');
  expect(card.item.formattingChanges).toEqual([
    { property: 'bold', value: 'true' },
    { property: 'italic', value: 'false' },
    { property: 'fontSize', value: '14' },
  ]);
  const label = 'Formatted: Swedish, Bold, Not italic, Font size: 14 pt';
  expect(revisionItemLabel(card.item, createT(en))).toBe(label);
  expect(vueRevisionItemLabel(card.item, createT(en))).toBe(label);
  expect(editor.rejectReviewItem(card.key).ok).toBe(true);
  expect(editor.getReviewItems()).toHaveLength(0);
  const xml = serializeOoxmlPart(editor.surface!.session.part());
  expect(xml).toContain('w:val="24"');
  expect(xml).not.toContain('<w:b/>');
  editor.destroy();
});

test('opposing paragraph-mark revisions sharing an address have distinct review keys', () => {
  const editor = mount({
    body: `<w:p><w:pPr><w:rPr><w:ins w:id="1" ${stamp}/><w:del w:id="1" ${stamp}/></w:rPr></w:pPr><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p>`,
  });
  const items = editor.getReviewItems();
  expect(items).toHaveLength(2);
  expect(new Set(items.map((item) => item.key)).size).toBe(2);
  const insertion = items.find(
    (item) => item.kind === 'revision' && item.item.markDirection === 'insert'
  )!;
  expect(editor.acceptReviewItem(insertion.key).ok).toBe(true);
  const remaining = editor.getReviewItems();
  expect(remaining).toHaveLength(1);
  expect(remaining[0]!.kind === 'revision' && remaining[0]!.item.markDirection).toBe('delete');
  expect(editor.rejectReviewItem(remaining[0]!.key).ok).toBe(true);
  expect(editor.surface!.session.paragraphIds()).toHaveLength(2);
  editor.destroy();
});

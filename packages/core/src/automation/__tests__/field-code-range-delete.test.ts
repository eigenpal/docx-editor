// The ops of a range delete over a whole complex field whose field codes hold paragraph marks
// (ECMA-376 Part 1, 17.16.18, CT_FldChar; 17.16.23, instrText). The plan composes existing ops,
// so collaboration replicates it like any range delete, and it is null for part of a field.
import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core/store';
import { wholeFieldRangeDeleteOps } from '../field-code-range-delete.ts';
import { storyParagraphs } from '../../store/package/story-blocks.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const FIELD =
  '<w:p><w:r><w:t>Alpha</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve">IF 1 = 1 "</w:instrText></w:r></w:p>' +
  '<w:p><w:r><w:instrText>Inside</w:instrText></w:r></w:p>' +
  '<w:p><w:r><w:instrText xml:space="preserve">" ""</w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Yes</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>Tail</w:t></w:r></w:p>';

function load(body: string): { part: OoxmlPart; ids: string[] } {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  });
  if (!read.ok) throw new Error('unreadable fixture');
  const bodyNode = read.part.root.children.find((node) => node.kind === 'body')!;
  return { part: read.part, ids: storyParagraphs(bodyNode).map((paragraph) => paragraph.id) };
}

test('the plan removes the inner paragraph, joins the rest, and deletes the field whole', () => {
  const { part, ids } = load(FIELD);
  expect(wholeFieldRangeDeleteOps(part, ids, 5, 3)).toEqual([
    { op: 'deleteBlock', blockId: ids[1]! },
    { op: 'joinParagraphs', firstId: ids[0]!, secondId: ids[2]! },
    // "Alpha", then the field as one model character.
    { op: 'deleteText', paragraphId: ids[0]!, start: 5, end: 6 },
  ]);
});

test('the plan keeps text beside the range and joins a paragraph that holds a field character', () => {
  const { part, ids } = load(
    FIELD.replace(
      '<w:instrText>Inside</w:instrText>',
      '<w:fldChar w:fldCharType="begin"/>'
    ).replace(
      '<w:r><w:instrText xml:space="preserve">" ""</w:instrText></w:r>',
      '<w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:instrText xml:space="preserve">" ""</w:instrText></w:r>'
    )
  );
  const ops = wholeFieldRangeDeleteOps(part, ids, 2, 4);
  expect(ops?.map((op) => op.op)).toEqual(['joinParagraphs', 'joinParagraphs', 'deleteText']);
});

test('a range that holds part of the field has no plan', () => {
  const { part, ids } = load(FIELD);
  // Ends inside the result, starts after `begin`, and holds no paragraph past the field codes.
  expect(wholeFieldRangeDeleteOps(part, ids, 5, 2)).toBeNull();
  expect(wholeFieldRangeDeleteOps(part, ids.slice(1), 0, 7)).toBeNull();
  expect(wholeFieldRangeDeleteOps(part, ids.slice(0, 2), 5, 0)).toBeNull();
});

const PAGE =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

test('a field that touches the range from outside stays and does not refuse the plan', () => {
  // `PAGE` right before `begin`, and right after `end`.
  const { part, ids } = load(
    FIELD.replace('<w:r><w:t>Alpha</w:t></w:r>', `<w:r><w:t>A</w:t></w:r>${PAGE}`).replace(
      '<w:r><w:t>Tail</w:t></w:r>',
      PAGE
    )
  );
  // "A", the `PAGE` field, then the `IF` field from offset 2; the result "Yes" ends at 3.
  const ops = wholeFieldRangeDeleteOps(part, ids, 2, 3);
  expect(ops?.at(-1)).toEqual({ op: 'deleteText', paragraphId: ids[0]!, start: 2, end: 3 });
});

test('a joined paragraph that ends a section has no plan', () => {
  const { part, ids } = load(
    FIELD.replace(
      '<w:p><w:r><w:instrText>Inside</w:instrText></w:r></w:p>',
      '<w:p><w:pPr><w:sectPr/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p>'
    ).replace(
      '<w:r><w:instrText xml:space="preserve">" ""',
      '<w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:instrText xml:space="preserve">" ""'
    )
  );
  expect(wholeFieldRangeDeleteOps(part, ids, 0, 7)).toBeNull();
});

test('paragraphs with fields closed inside them are removed, not joined', () => {
  const rows = Array.from(
    { length: 400 },
    (_, row) => `<w:p><w:r><w:t>r${row}</w:t></w:r>${PAGE}</w:p>`
  );
  const { part, ids } = load(FIELD + rows.join(''));
  const started = performance.now();
  const ops = wholeFieldRangeDeleteOps(part, ids, 0, 2 + String(399).length);
  expect(performance.now() - started).toBeLessThan(2000);
  expect(ops?.filter((op) => op.op === 'joinParagraphs')).toHaveLength(2);
  expect(ops?.filter((op) => op.op === 'deleteBlock')).toHaveLength(400);
});

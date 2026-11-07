/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Links and fields that only one document has: the whole field goes into the revision, so
// accepting or rejecting it leaves no empty link or field behind, and an empty simple field
// (a field that shows its value with no saved result) stays in the output.
import { expect, test } from 'bun:test';
import { applyTreeOp, readOoxmlPackage, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { compareDocuments } from '../index.ts';

const DATE = new Date('2026-01-10T12:00:00Z');
const docx = (body: string) => buildDocx({ body });
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (inner: string) => `<w:p>${inner}</w:p>`;

function compared(base: Uint8Array, revised: Uint8Array): Uint8Array {
  const result = compareDocuments(base, revised, { authorName: 'Test', date: DATE });
  if (!result.ok) throw new Error(result.message);
  return result.bytes;
}

function mainXml(bytes: Uint8Array, op?: 'acceptAllRevisions' | 'rejectAllRevisions'): string {
  const read = readOoxmlPackage(bytes);
  if (!read.ok) throw new Error(read.reason);
  const part = read.package.parts.get(read.package.mainDocumentPart)!;
  if (!op) return serializeOoxmlPart(part);
  const result = applyTreeOp(part, { op });
  if (!result.ok) throw new Error(result.reason);
  return serializeOoxmlPart(result.part);
}

const link = (text: string) => `<w:hyperlink w:anchor="terms">${run(text)}</w:hyperlink>`;

test('a link that keeps part of its text stays a link, with no field for its deleted words', () => {
  const linked = (words: string[]) =>
    docx(para(`<w:hyperlink w:anchor="terms">${words.map(run).join('')}</w:hyperlink>`));
  const out = compared(
    linked(['of ', 'DOCX ', 'support ', 'in ', 'calibre']),
    linked(['Demonstration ', 'standard ', 'internal ', 'record ', 'calibre'])
  );
  const xml = mainXml(out);
  // A field for each deleted piece nests fields inside a table of contents entry, and the
  // file becomes unreadable.
  expect(xml).not.toContain('HYPERLINK');
  expect(xml).not.toContain('fldChar');
  expect(mainXml(out, 'acceptAllRevisions')).toContain('Demonstration');
  expect(mainXml(out, 'rejectAllRevisions')).toContain('DOCX');
});

test('an added link is a hyperlink field inside the insertion, so reject leaves no link', () => {
  const plain = docx(para(`${run('See ')}${run('the terms')}${run(' now.')}`));
  const linked = docx(para(`${run('See ')}${link('the terms')}${run(' now.')}`));
  const out = compared(plain, linked);
  const xml = mainXml(out);
  expect(xml).not.toContain('<w:hyperlink');
  expect(xml).toMatch(/<w:ins\b(?:(?!<\/w:ins>).)*HYPERLINK \\l &quot;terms&quot;/s);
  expect(mainXml(out, 'rejectAllRevisions')).not.toMatch(/hyperlink|HYPERLINK/i);
  expect(mainXml(out, 'acceptAllRevisions')).toContain('HYPERLINK \\l &quot;terms&quot;');
  // The other way round: the removed link goes with its deletion.
  expect(mainXml(compared(linked, plain), 'acceptAllRevisions')).not.toMatch(/hyperlink/i);
});

test('a simple field with another instruction is replaced as a whole field', () => {
  const field = (name: string) =>
    docx(
      para(
        `${run('Dear ')}<w:fldSimple w:instr=" MERGEFIELD ${name} ">${run(`«${name}»`)}</w:fldSimple>`
      )
    );
  const out = compared(field('FirstName'), field('LastName'));
  expect(mainXml(out)).not.toContain('<w:fldSimple');
  const accepted = mainXml(out, 'acceptAllRevisions');
  expect(accepted).toContain('MERGEFIELD LastName');
  expect(accepted).not.toContain('FirstName');
  const rejected = mainXml(out, 'rejectAllRevisions');
  expect(rejected).toContain('MERGEFIELD FirstName');
  expect(rejected).not.toContain('LastName');
});

test('a field turned into its own result text deletes the field and inserts the text', () => {
  const date =
    `${run('Printed ')}<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> DATE </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('1/5/2026')}` +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const out = compared(docx(para(date)), docx(para(run('Printed 1/5/2026'))));
  const xml = mainXml(out);
  // The result text is inserted, never kept as equal text between deleted field characters.
  expect(xml).toMatch(/<w:ins\b[^>]*>(?:(?!<\/w:ins>).)*1\/5\/2026/s);
  expect(xml).toMatch(/<w:del\b[^>]*>(?:(?!<\/w:del>).)*1\/5\/2026/s);
  const accepted = mainXml(out, 'acceptAllRevisions');
  expect(accepted).toContain('1/5/2026');
  expect(accepted).not.toContain('fldChar');
  expect(mainXml(out, 'rejectAllRevisions')).toContain('DATE');
});

test('an empty simple field stays in the output', () => {
  const page = '<w:fldSimple w:instr="PAGE"/>';
  const base = docx(para(`${run('Page ')}${page}`) + para(run('One.')));
  const revised = docx(para(`${run('Page ')}${page}`) + para(run('Two.')));
  const out = compared(base, revised);
  expect(mainXml(out)).toMatch(/<w:fldSimple w:instr="PAGE"/);
  // Added with a new paragraph: inserted as a field, so accept shows it and reject removes it.
  const added = compared(base, docx(para(`${run('Page ')}${page}`) + para(`${run('Of ')}${page}`)));
  expect(mainXml(added, 'acceptAllRevisions').match(/PAGE/g)?.length).toBe(2);
  expect(mainXml(added, 'rejectAllRevisions').match(/PAGE/g)?.length).toBe(1);
});

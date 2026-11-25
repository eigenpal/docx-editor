/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An `IF` field whose field codes hold paragraph marks (ECMA-376 Part 1, 17.16.18, CT_FldChar;
// 17.16.23, instrText). A write that would add one more paragraph mark inside the field codes
// is refused with `InvalidArgument`, and the document does not change. Writes beside the field
// still apply.
import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor, type DocxEditorServerRuntime, type RequestContext } from '../../index.ts';
import { docx, p } from './support/docx.ts';

const FIELD =
  p('Top') +
  '<w:p><w:r><w:t>Alpha</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve">IF 1 = 1 "</w:instrText></w:r></w:p>' +
  '<w:p><w:r><w:instrText>Inside</w:instrText></w:r></w:p>' +
  '<w:p><w:r><w:instrText xml:space="preserve">" ""</w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Yes</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
  p('Bottom');

async function bodyXml(r: DocxEditorServerRuntime): Promise<string> {
  const xml = strFromU8(unzipSync(await r.save())['word/document.xml']!);
  return xml.slice(xml.indexOf('<w:body>'), xml.indexOf('</w:body>'));
}

async function refusal(work: (c: RequestContext) => void): Promise<unknown> {
  const runtime = await DocxEditor.createServer(docx(FIELD));
  const before = await bodyXml(runtime);
  let code: unknown = null;
  await runtime.run(async (c) => {
    c.document.body.paragraphs.load('items');
    await c.sync();
    work(c);
    try {
      await c.sync();
    } catch (error) {
      code = (error as { code?: unknown }).code;
    }
  });
  expect(await bodyXml(runtime)).toBe(before);
  runtime.dispose();
  return code;
}

describe('a write that would add a paragraph mark inside field codes', () => {
  const item = (c: RequestContext, index: number) => c.document.body.paragraphs.items[index]!;
  const writes: [string, (c: RequestContext) => void][] = [
    ['insertParagraph before the result side', (c) => item(c, 3).insertParagraph('', 'Before')],
    [
      'insertParagraph after a field-code paragraph',
      (c) => item(c, 2).insertParagraph('x', 'After'),
    ],
    [
      'insertText with a leading line break at the result start',
      (c) => item(c, 3).insertText('\nQ', 'Start'),
    ],
    [
      'insertBreak SectionNext at the result start',
      (c) => item(c, 3).getRange('Start').insertBreak('SectionNext', 'Before'),
    ],
  ];
  for (const [label, write] of writes) {
    test(`${label} is refused`, async () => {
      expect(await refusal(write)).toBe('InvalidArgument');
    });
  }

  test('writes beside the field still apply', async () => {
    const runtime = await DocxEditor.createServer(docx(FIELD));
    await runtime.run(async (c) => {
      const paragraphs = c.document.body.paragraphs;
      paragraphs.load('items');
      await c.sync();
      paragraphs.items[3]!.insertParagraph('after', 'After');
      paragraphs.items[1]!.insertParagraph('before', 'Before');
      await c.sync();
    });
    const xml = await bodyXml(runtime);
    expect(xml.indexOf('before')).toBeLessThan(xml.indexOf('fldCharType="begin"'));
    expect(xml.indexOf('>after<')).toBeGreaterThan(xml.indexOf('fldCharType="end"'));
    runtime.dispose();
  });
});

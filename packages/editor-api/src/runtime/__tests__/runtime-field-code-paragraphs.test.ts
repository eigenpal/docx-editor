/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An `IF` field whose field codes hold paragraph marks (ECMA-376 Part 1, 17.16.18, CT_FldChar;
// 17.16.23, instrText). A write that would add one more paragraph mark inside the field codes
// is refused with `NotSupported`, and the document does not change. Writes beside the field
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

async function refusal(work: (c: RequestContext) => void, tracked = false): Promise<unknown> {
  const runtime = await DocxEditor.createServer(docx(FIELD), { author: 'Agent' });
  const before = await bodyXml(runtime);
  let code: unknown = null;
  await runtime.run(async (c) => {
    if (tracked) c.document.changeTrackingMode = 'TrackMineOnly';
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
      expect(await refusal(write)).toBe('NotSupported');
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

describe('a delete that would remove a paragraph mark inside field codes', () => {
  const item = (c: RequestContext, index: number) => c.document.body.paragraphs.items[index]!;
  const deletes: [string, (c: RequestContext) => void][] = [
    ['Paragraph.delete on a paragraph inside the field codes', (c) => item(c, 2).delete()],
    ['Paragraph.delete on the paragraph that holds begin', (c) => item(c, 1).delete()],
    [
      'Range.delete from the begin paragraph into the result',
      (c) => item(c, 1).getRange('Whole').expandTo(item(c, 3).getRange('Start')).delete(),
    ],
    [
      'Range.delete from inside the field codes to the result start',
      (c) => item(c, 2).getRange('Whole').expandTo(item(c, 3).getRange('Start')).delete(),
    ],
    [
      'Range.insertText Replace from inside the field codes to the result start',
      (c) =>
        item(c, 2)
          .getRange('Whole')
          .expandTo(item(c, 3).getRange('Start'))
          .insertText('Z', 'Replace'),
    ],
    [
      'Range.delete from the field codes past the field',
      (c) => item(c, 2).getRange('Whole').expandTo(item(c, 4).getRange('Whole')).delete(),
    ],
  ];
  for (const [label, remove] of deletes) {
    test(`${label} is refused`, async () => {
      expect(await refusal(remove)).toBe('NotSupported');
    });
    test(`${label} is refused while tracking`, async () => {
      expect(await refusal(remove, true)).toBe('NotSupported');
    });
  }

  test('Range.delete over the whole field is refused too', async () => {
    const remove = (c: RequestContext) =>
      item(c, 1).getRange('Whole').expandTo(item(c, 3).getRange('Whole')).delete();
    expect(await refusal(remove)).toBe('NotSupported');
  });

  test('a range delete that ends before the field still applies', async () => {
    const runtime = await DocxEditor.createServer(docx(FIELD));
    await runtime.run(async (c) => {
      const paragraphs = c.document.body.paragraphs;
      paragraphs.load('items');
      await c.sync();
      item(c, 0).getRange('Whole').expandTo(item(c, 1).getRange('Start')).delete();
      await c.sync();
    });
    const xml = await bodyXml(runtime);
    expect(xml).not.toContain('Top');
    expect(xml.match(/instrText/g)).toHaveLength(6);
    runtime.dispose();
  });
});

describe('a table that would land inside field codes', () => {
  const item = (c: RequestContext, index: number) => c.document.body.paragraphs.items[index]!;
  const tables: [string, (c: RequestContext) => void][] = [
    ['before the result paragraph', (c) => item(c, 3).insertTable(1, 1, 'Before', [['x']])],
    [
      'after a paragraph inside the field codes',
      (c) => item(c, 2).insertTable(1, 1, 'After', [['x']]),
    ],
    ['after the paragraph that holds begin', (c) => item(c, 1).insertTable(1, 1, 'After', [['x']])],
  ];
  for (const [label, insert] of tables) {
    test(`${label} is refused`, async () => {
      expect(await refusal(insert)).toBe('NotSupported');
    });
    test(`${label} is refused while tracking`, async () => {
      expect(await refusal(insert, true)).toBe('NotSupported');
    });
  }

  test('a table after the field still applies', async () => {
    const runtime = await DocxEditor.createServer(docx(FIELD));
    await runtime.run(async (c) => {
      c.document.body.paragraphs.load('items');
      await c.sync();
      item(c, 3).insertTable(1, 1, 'After', [['x']]);
      await c.sync();
    });
    const xml = await bodyXml(runtime);
    expect(xml.indexOf('<w:tbl')).toBeGreaterThan(xml.indexOf('fldCharType="end"'));
    runtime.dispose();
  });
});

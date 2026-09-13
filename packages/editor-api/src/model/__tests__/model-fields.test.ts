/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { DocxEditor, FieldType } from '../../index.ts';
import { createFixedMeasurer } from '../../../../core/src/layout/semantic-layout.ts';
import { docx, mainXmlOf, p, reopen, serverRuntime } from './support/documents.ts';

const FIXTURE = docx(
  p('anchor') +
    '<w:p><w:fldSimple w:instr="DATE"><w:r><w:rPr><w:i/></w:rPr><w:t>preserved cache</w:t></w:r></w:fldSimple></w:p>' +
    p('sentinel')
);

test('insert, retarget code, reopen, and delete a field without changing unrelated fields', async () => {
  const runtime = await serverRuntime(FIXTURE);
  await runtime.run(async (context) => {
    const hits = context.document.body.search('anchor');
    hits.load('items');
    await context.sync();
    const field = hits.items[0]!.insertField('After', FieldType.page);
    await context.sync();
    field.load('code');
    await context.sync();
    expect(field.code.trim()).toBe('PAGE');
    field.code = 'NUMPAGES';
    await context.sync();
    field.load('code');
    await context.sync();
    expect(field.code.trim()).toBe('NUMPAGES');
  });
  const saved = await reopen(runtime);
  await saved.run(async (context) => {
    const fields = context.document.body.fields;
    fields.load('items');
    await context.sync();
    expect(fields.items).toHaveLength(2);
    fields.items[0]!.load('code');
    fields.items[1]!.load('code');
    await context.sync();
    expect(fields.items[0]!.code.trim()).toBe('NUMPAGES');
    expect(fields.items[1]!.code).toBe('DATE');
    fields.items[0]!.delete();
    await context.sync();
    fields.load('items');
    await context.sync();
    expect(fields.items).toHaveLength(1);
  });
  const xml = await mainXmlOf(saved);
  expect(xml).toContain('w:instr="DATE"');
  expect(xml).toContain('preserved cache');
  expect(xml).toContain('sentinel');
  saved.dispose();
  runtime.dispose();
});

test('existing simple page field code keeps result formatting and switches refuse atomically', async () => {
  const runtime = await serverRuntime(
    docx(
      '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:b/></w:rPr><w:t>7</w:t></w:r></w:fldSimple></w:p>'
    )
  );
  await runtime.run(async (context) => {
    const field = context.document.body.fields.getFirst();
    await context.sync();
    field.code = 'NUMPAGES';
    await context.sync();
  });
  const xml = await mainXmlOf(runtime);
  expect(xml).toContain('w:instr="NUMPAGES"');
  expect(xml).toContain('<w:b');
  expect(xml).toContain('>7<');
  await expect(
    runtime.run(async (context) => {
      const field = context.document.body.fields.getFirst();
      await context.sync();
      field.code = 'INCLUDETEXT "https://example.com/secret"';
      await context.sync();
    })
  ).rejects.toMatchObject({ code: 'InvalidArgument' });
  expect(await mainXmlOf(runtime)).toBe(xml);
  runtime.dispose();
});

test('updateResult requires actual pagination and preserves the package when unavailable', async () => {
  const runtime = await serverRuntime(
    docx('<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>7</w:t></w:r></w:fldSimple></w:p>')
  );
  const before = await mainXmlOf(runtime);
  await expect(
    runtime.run(async (context) => {
      const field = context.document.body.fields.getFirst();
      await context.sync();
      field.updateResult();
      await context.sync();
    })
  ).rejects.toMatchObject({ code: 'NotSupported' });
  expect(await mainXmlOf(runtime)).toBe(before);
  runtime.dispose();
});

test('PAGE and NUMPAGES compute from actual two-page semantic pagination and persist on reopen', async () => {
  const runtime = await DocxEditor.createServer(
    docx(
      p('first page') +
        '<w:p><w:r><w:br w:type="page"/><w:t>second page</w:t></w:r></w:p>' +
        p('total pages')
    ),
    { pagination: { measurer: createFixedMeasurer(6, 14) } }
  );
  await runtime.run(async (context) => {
    const hits = context.document.body.search('second page');
    hits.load('items');
    await context.sync();
    hits.items[0]!.insertField('After', 'Page');
    await context.sync();
  });
  await runtime.run(async (context) => {
    const hits = context.document.body.search('total pages');
    hits.load('items');
    await context.sync();
    hits.items[0]!.insertField('After', 'NumPages');
    await context.sync();
  });
  await runtime.run(async (context) => {
    const fields = context.document.body.fields;
    fields.load('items');
    await context.sync();
    expect(fields.items).toHaveLength(2);
    fields.items[0]!.updateResult();
    await context.sync();
    fields.items[1]!.updateResult();
    await context.sync();
  });
  const saved = await reopen(runtime);
  await saved.run(async (context) => {
    context.document.body.load('text');
    await context.sync();
    expect(context.document.body.text).toContain('second page2');
    expect(context.document.body.text).toContain('total pages2');
  });
  saved.dispose();
  runtime.dispose();
});

test('split complex instruction code writes preserve chrome, cache, and run formatting', async () => {
  const runtime = await serverRuntime(
    docx(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PA</w:instrText></w:r><w:r><w:instrText xml:space="preserve">GE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>4</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    )
  );
  await runtime.run(async (context) => {
    const field = context.document.body.fields.getFirst();
    await context.sync();
    field.code = 'NUMPAGES';
    await context.sync();
    field.load('code');
    await context.sync();
    expect(field.code.trim()).toBe('NUMPAGES');
  });
  const xml = await mainXmlOf(runtime);
  expect(xml).toContain('w:fldCharType="begin"');
  expect(xml).toContain('w:fldCharType="separate"');
  expect(xml).toContain('w:fldCharType="end"');
  expect(xml).toContain('>4<');
  expect(xml).toContain('<w:b');
  runtime.dispose();
});

for (const fieldType of ['Date', 'IncludeText', 'MacroButton'] as const) {
  test(`${fieldType} authoring refuses without touching the document`, async () => {
    const runtime = await serverRuntime(FIXTURE);
    const before = await mainXmlOf(runtime);
    await expect(
      runtime.run(async (context) => {
        const hits = context.document.body.search('anchor');
        hits.load('items');
        await context.sync();
        hits.items[0]!.insertField('After', fieldType);
        await context.sync();
      })
    ).rejects.toMatchObject({ code: 'InvalidArgument' });
    expect(await mainXmlOf(runtime)).toBe(before);
    runtime.dispose();
  });
}

test('read-derived field writes defer addressing until sync', async () => {
  const runtime = await serverRuntime(
    docx('<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>')
  );
  await runtime.run(async (context) => {
    const field = context.document.body.fields.getFirst();
    field.code = 'NUMPAGES';
    await context.sync();
    field.load('code');
    await context.sync();
    expect(field.code).toBe('NUMPAGES');
  });
  runtime.dispose();
});

test('multiple field result updates in one paragraph share measured pagination', async () => {
  const runtime = await DocxEditor.createServer(
    docx(
      '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>0</w:t></w:r></w:fldSimple><w:r><w:t> of </w:t></w:r><w:fldSimple w:instr="NUMPAGES"><w:r><w:t>0</w:t></w:r></w:fldSimple></w:p>'
    ),
    { pagination: { measurer: createFixedMeasurer(6, 14) } }
  );
  await runtime.run(async (context) => {
    const fields = context.document.body.fields;
    fields.load('items');
    await context.sync();
    fields.items[0]!.updateResult();
    fields.items[1]!.updateResult();
    await context.sync();
    context.document.body.load('text');
    await context.sync();
    expect(context.document.body.text).toBe('1 of 1');
  });
  runtime.dispose();
});

test('field result updates cannot mix with layout-changing writes', async () => {
  const runtime = await DocxEditor.createServer(
    docx(
      '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>0</w:t></w:r></w:fldSimple></w:p>' + p('sentinel')
    ),
    { pagination: { measurer: createFixedMeasurer(6, 14) } }
  );
  const before = await mainXmlOf(runtime);
  await expect(
    runtime.run(async (context) => {
      const field = context.document.body.fields.getFirst();
      await context.sync();
      field.updateResult();
      context.document.body.insertParagraph('new paragraph', 'End');
      await context.sync();
    })
  ).rejects.toMatchObject({ code: 'ConflictingChanges' });
  expect(await mainXmlOf(runtime)).toBe(before);
  runtime.dispose();
});

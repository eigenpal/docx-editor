import { expect, test } from 'bun:test';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { zipDocument } from '../../../../packages/pro/src/collaboration/__tests__/document-peer-support';
import { runWriterTool } from './run-tool';
import { editPropertiesSchema, readPropertiesSchema } from './document-properties';

test('writer edits selected metadata and preserves unrelated properties and body', async () => {
  const runtime = await DocxEditor.createServer(
    zipDocument('<w:p><w:r><w:t>Sentinel</w:t></w:r></w:p>')
  );
  try {
    await runtime.run(async (c) => {
      c.document.properties.author = 'Retained';
      c.document.properties.subject = 'Unchanged';
      await c.sync();
    });
    const result = await runWriterTool(
      runtime,
      null,
      'edit_properties',
      { title: 'Title', keywords: 'public' },
      'direct'
    );
    expect(result.success, result.output).toBe(true);
    const read = await runWriterTool(runtime, null, 'read_properties', {
      properties: ['title', 'author'],
    });
    expect(JSON.parse(read.output)).toEqual({ title: 'Title', author: 'Retained' });
    const reopened = await DocxEditor.createServer(await runtime.save());
    try {
      await reopened.run(async (c) => {
        c.document.properties.load('subject,keywords');
        c.document.body.load('text');
        await c.sync();
        expect(c.document.properties.subject).toBe('Unchanged');
        expect(c.document.properties.keywords).toBe('public');
        expect(c.document.body.text).toBe('Sentinel');
      });
    } finally {
      reopened.dispose();
    }
    const refused = await runWriterTool(
      runtime,
      null,
      'edit_properties',
      { title: 'Proposed' },
      'suggest'
    );
    expect(refused.success).toBe(false);
    expect(refused.code).toBe('NotSupported');
    const after = await runWriterTool(runtime, null, 'read_properties', { properties: ['title'] });
    expect(JSON.parse(after.output)).toEqual({ title: 'Title' });
  } finally {
    runtime.dispose();
  }
});

test('metadata schemas reject unknown fields and empty writes', () => {
  expect(editPropertiesSchema.safeParse({}).success).toBe(false);
  expect(editPropertiesSchema.safeParse({ title: 'ok', internal: 'hidden' }).success).toBe(false);
  expect(editPropertiesSchema.safeParse({ author: 7 }).success).toBe(false);
  expect(editPropertiesSchema.safeParse({ comments: '' }).success).toBe(true);
  expect(readPropertiesSchema.safeParse({ properties: ['revision'] }).success).toBe(false);
});

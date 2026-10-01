import { expect, test } from 'bun:test';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { seedDocx } from '../seed-document';
import { runWriterTool } from './run-tool';
const brief = {
  documentType: 'Memo',
  partiesOrAudience: 'Team',
  purpose: 'Inform',
  jurisdictionOrDomainRules: 'General',
  tone: 'Plain',
  length: 'Short',
};
for (const mode of ['direct', 'suggest'] as const) {
  test(`invalid draft formatting refuses before body replacement in ${mode}`, async () => {
    const runtime = await DocxEditor.createServer(seedDocx(), { author: 'Writer' });
    try {
      const before = await runWriterTool(runtime, null, 'read_document', {});
      for (const format of [
        [{ property: 'style', value: 'MissingNamedStyle' }],
        [{ property: 'size', value: 1200 }],
        [{ property: 'spaceAfter', value: -5 }],
        [{ property: 'leftIndent', value: 2000 }],
        [{ property: 'name', value: 'Bad\u0001Font' }],
      ]) {
        const result = await runWriterTool(
          runtime,
          null,
          'create_document',
          {
            brief,
            title: 'Memo',
            blocks: [{ kind: 'paragraph', text: 'Replacement', style: 'Normal', format }],
          },
          mode
        );
        expect(result.code).toBe('InvalidArgument');
        expect(result.completedSteps).toEqual([]);
        const after = await runWriterTool(runtime, null, 'read_document', {});
        expect(JSON.parse(after.output).items).toEqual(JSON.parse(before.output).items);
      }
      const revisions = await runWriterTool(runtime, null, 'inspect_document', {
        area: 'revisions',
      });
      expect(JSON.parse(revisions.output).items).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });
}

test('draft paragraph style remains supported through block.style', async () => {
  const runtime = await DocxEditor.createServer(seedDocx());
  try {
    const result = await runWriterTool(
      runtime,
      null,
      'create_document',
      {
        brief,
        title: 'Memo',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Purpose',
            style: 'Heading 1',
            format: [{ property: 'spaceAfter', value: 12 }],
          },
        ],
      },
      'direct'
    );
    expect(result.success, result.output).toBe(true);
    const read = await runWriterTool(runtime, null, 'read_document', {});
    expect(JSON.parse(read.output).items[0]).toMatchObject({ text: 'Purpose', style: 'Heading 1' });
  } finally {
    runtime.dispose();
  }
});

test('invalid draft text refuses before clear for each block type', async () => {
  const runtime = await DocxEditor.createServer(seedDocx());
  try {
    const before = await runWriterTool(runtime, null, 'read_document', {});
    for (const block of [
      { kind: 'paragraph', text: 'Invalid\u0000text' },
      { kind: 'paragraph', text: '\uD800', runs: [{ text: '\uD800' }] },
      { kind: 'list', listType: 'bullet', items: ['Invalid\u0000text'] },
      { kind: 'table', rows: [['Invalid\u0000text']] },
    ]) {
      const result = await runWriterTool(
        runtime,
        null,
        'create_document',
        { brief, title: 'Memo', blocks: [block] },
        'direct'
      );
      expect(result.code).toBe('InvalidArgument');
      expect(result.completedSteps).toEqual([]);
      const after = await runWriterTool(runtime, null, 'read_document', {});
      expect(JSON.parse(after.output).items).toEqual(JSON.parse(before.output).items);
    }
  } finally {
    runtime.dispose();
  }
});

for (const mode of ['direct', 'suggest'] as const)
  test(`missing imported draft style refuses before replacement in ${mode}`, async () => {
    const { zipDocument } =
      await import('../../../../packages/pro/src/collaboration/__tests__/document-peer-support');
    const runtime = await DocxEditor.createServer(
      zipDocument('<w:p><w:r><w:t>Original imported text</w:t></w:r></w:p>'),
      { author: 'Writer' }
    );
    try {
      const before = await runWriterTool(runtime, null, 'read_document', {});
      const result = await runWriterTool(
        runtime,
        null,
        'create_document',
        {
          brief,
          title: 'Memo',
          blocks: [{ kind: 'paragraph', text: 'Replacement', style: 'Heading 1' }],
        },
        mode
      );
      expect(result.success).toBe(false);
      expect(result.code).toBe('InvalidArgument');
      expect(result.completedSteps).toEqual([]);
      const after = await runWriterTool(runtime, null, 'read_document', {});
      expect(JSON.parse(after.output).items).toEqual(JSON.parse(before.output).items);
    } finally {
      runtime.dispose();
    }
  });

import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { reviewModule } from '@docx-editor.dev/pro';
import { seedDocx } from '../seed-document';
import { createWriterRuntime, runWriterTool } from './run-tool';

const input = {
  brief: {
    documentType: 'project plan',
    partiesOrAudience: 'Example team',
    purpose: 'plan a project',
    jurisdictionOrDomainRules: 'internal process',
    tone: 'clear',
    length: 'one page',
  },
  title: 'Project plan',
  blocks: [
    {
      kind: 'paragraph',
      text: 'Project plan',
      style: 'Title',
      format: [{ property: 'alignment', value: 'Centered' }],
    },
    {
      kind: 'paragraph',
      text: 'Shared words and Shared words',
      runs: [
        { text: 'Shared words', font: { bold: true } },
        { text: ' and ' },
        { text: 'Shared words', font: { bold: false, italic: true, color: '#113355' } },
      ],
      format: [{ property: 'alignment', value: 'Justified' }],
    },
    { kind: 'list', listType: 'bullet', items: ['Plan the work', 'Review the result'] },
    {
      kind: 'table',
      rows: [
        ['Milestone', 'Date'],
        ['Review', '2026-10-01'],
      ],
      headerRowCount: 1,
      headerFont: { bold: true },
    },
  ],
};

for (const mode of ['direct', 'suggest'] as const) {
  test(`rich ${mode} draft saves mixed runs, lists, and a formatted table`, async () => {
    const runtime = await DocxEditor.createServer(seedDocx(), { author: 'Writer agent' });
    try {
      const result = await runWriterTool(runtime, null, 'create_document', input, mode);
      expect(result.success, JSON.stringify(result)).toBe(true);
      const bytes = await runtime.save();
      for (const decision of mode === 'suggest'
        ? (['acceptAll', 'rejectAll'] as const)
        : (['acceptAll'] as const)) {
        const reopened = await DocxEditor.createServer(bytes);
        try {
          await reopened.run(async (c) => {
            c.document.revisions[decision]();
            await c.sync();
            c.document.revisions.load('items');
            c.document.body.load('text');
            c.document.body.tables.load('items');
            c.document.body.lists.load('items');
            await c.sync();
            expect(c.document.revisions.items).toHaveLength(0);
            if (decision === 'rejectAll') {
              expect(c.document.body.text).toContain('Draft project proposal');
              expect(c.document.body.text).not.toContain('Shared words');
              expect(c.document.body.tables.items).toHaveLength(0);
              expect(c.document.body.lists.items).toHaveLength(0);
            } else {
              expect(c.document.body.text).toContain('Shared words and Shared words');
              expect(c.document.body.text).not.toContain('Draft project proposal');
              expect(c.document.body.tables.items).toHaveLength(1);
              expect(c.document.body.lists.items).toHaveLength(1);
              const matches = c.document.body.search('Shared words', { matchCase: true });
              matches.load('items');
              await c.sync();
              expect(matches.items).toHaveLength(2);
              const bold = matches.items[0]!.font;
              const italic = matches.items[1]!.font;
              bold.load(['bold', 'italic']);
              italic.load(['bold', 'italic', 'color']);
              const normal = c.document.body.search(' and ', { matchCase: true }).getFirst().font;
              normal.load(['bold', 'italic']);
              const table = c.document.body.tables.getFirst();
              table.load(['values', 'headerRowCount']);
              await c.sync();
              expect(normal.bold).not.toBe(true);
              expect(normal.italic).not.toBe(true);
              expect(bold.bold).toBe(true);
              expect(bold.italic).not.toBe(true);
              expect(italic.bold).toBe(false);
              expect(italic.italic).toBe(true);
              expect(italic.color).toBe('#113355');
              expect(table.values).toEqual(input.blocks[3]!.rows!);
              expect(table.headerRowCount).toBe(1);
            }
          });
          const xml = strFromU8(unzipSync(await reopened.save())['word/document.xml']!);
          if (decision === 'acceptAll') expect(xml).toContain('w:tblHeader');
        } finally {
          reopened.dispose();
        }
      }
    } finally {
      runtime.dispose();
    }
  });
}

test('browser writer saves once per call and refuses edits after document replacement', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: seedDocx(),
    author: 'Writer agent',
    modules: [reviewModule()],
  });
  const runtime = createWriterRuntime(editor);
  const save = editor.save.bind(editor);
  let saves = 0;
  editor.save = async () => {
    saves++;
    return save();
  };
  try {
    const result = await runWriterTool(runtime, editor, 'create_document', input, 'direct');
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(saves).toBe(1);
    expect((await runWriterTool(runtime, editor, 'read_document', {})).success).toBe(true);
    expect(saves).toBe(2);
    await editor.load(seedDocx());
    const stale = await runWriterTool(
      runtime,
      editor,
      'write_story',
      { story: { kind: 'body' }, text: 'Unwanted replacement', location: 'Replace' },
      'direct'
    );
    expect(stale).toMatchObject({ success: false, code: 'StaleDocument' });
    const reread = await runWriterTool(runtime, editor, 'read_document', {});
    expect(reread.success).toBe(true);
    expect(reread.output).not.toContain('Unwanted replacement');
  } finally {
    runtime.dispose();
    editor.destroy();
    container.remove();
  }
});

for (const mode of ['direct', 'suggest'] as const) {
  test(`inserted text font in ${mode} survives saved review`, async () => {
    const runtime = await DocxEditor.createServer(seedDocx(), { author: 'Writer agent' });
    try {
      const read = await runWriterTool(runtime, null, 'read_document', {});
      const target = JSON.parse(read.output).items[0];
      const result = await runWriterTool(
        runtime,
        null,
        'edit_text',
        {
          edits: [
            {
              action: 'insertText',
              target: { paragraphId: target.id },
              location: 'End',
              text: ' — updated',
              font: { bold: true, italic: true, color: '#113355' },
            },
          ],
        },
        mode
      );
      expect(result.success, JSON.stringify(result)).toBe(true);
      const bytes = await runtime.save();
      for (const decision of mode === 'suggest'
        ? (['acceptAll', 'rejectAll'] as const)
        : (['acceptAll'] as const)) {
        const reopened = await DocxEditor.createServer(bytes);
        try {
          await reopened.run(async (c) => {
            c.document.revisions[decision]();
            await c.sync();
            c.document.body.load('text');
            await c.sync();
            if (decision === 'rejectAll') expect(c.document.body.text).not.toContain(' — updated');
            else {
              const font = c.document.body.search(' — updated').getFirst().font;
              font.load(['bold', 'italic', 'color']);
              await c.sync();
              expect(font.bold).toBe(true);
              expect(font.italic).toBe(true);
              expect(font.color).toBe('#113355');
            }
          });
        } finally {
          reopened.dispose();
        }
      }
    } finally {
      runtime.dispose();
    }
  });
}

test('multiple typed and text controls in one paragraph preserve labels and saved types', async () => {
  const runtime = await DocxEditor.createServer(seedDocx(), { author: 'Writer agent' });
  try {
    await runtime.run(async (c) => {
      c.document.body.insertText('Name: [Name] Date: [Date] Notes: [Notes]', 'Replace');
      await c.sync();
    });
    const read = await runWriterTool(runtime, null, 'read_document', {});
    const target = JSON.parse(read.output).items[0];
    const result = await runWriterTool(
      runtime,
      null,
      'insert_content_controls',
      {
        fields: [
          {
            paragraphId: target.id,
            search: '[Name]',
            type: 'PlainText',
            tag: 'name',
            title: 'Name',
          },
          {
            paragraphId: target.id,
            search: '[Date]',
            type: 'DatePicker',
            tag: 'date',
            title: 'Date',
          },
          {
            paragraphId: target.id,
            search: '[Notes]',
            type: 'RichText',
            tag: 'notes',
            title: 'Notes',
          },
        ],
      },
      'direct'
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
    const reopened = await DocxEditor.createServer(await runtime.save());
    try {
      await reopened.run(async (c) => {
        c.document.body.load('text');
        c.document.body.contentControls.load('items');
        await c.sync();
        for (const control of c.document.body.contentControls.items)
          control.load(['subtype', 'tag']);
        await c.sync();
        expect(c.document.body.text).toBe('Name: [Name] Date: [Date] Notes: [Notes]');
        expect(
          c.document.body.contentControls.items.map((control) => [control.tag, control.subtype])
        ).toEqual([
          ['name', 'plainText'],
          ['date', 'date'],
          ['notes', 'richText'],
        ]);
      });
    } finally {
      reopened.dispose();
    }
  } finally {
    runtime.dispose();
  }
});

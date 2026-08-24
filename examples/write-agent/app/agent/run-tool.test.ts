import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { reviewModule } from '@docx-editor.dev/pro';
import type { DocxEditorRuntime } from '@docx-editor.dev/editor-api/browser';
import { seedDocx } from '../seed-document';
import { createWriterRuntime, runWriterTool } from './run-tool';

const brief = {
  documentType: 'mutual NDA',
  partiesOrAudience: 'Company A and Company B',
  purpose: 'evaluate a project',
  jurisdictionOrDomainRules: 'generic United States terms',
  tone: 'plain and balanced',
  length: 'two pages',
};

describe('writer agent browser tools', () => {
  let editor: DocxEditorInstance;
  let runtime: DocxEditorRuntime;

  beforeAll(() => {
    if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
    const container = document.createElement('div');
    document.body.appendChild(container);
    editor = createDocxEditor({
      container,
      document: seedDocx(),
      author: 'Writer agent',
      modules: [reviewModule()],
    });
    runtime = createWriterRuntime(editor);
  });

  afterAll(() => {
    runtime.dispose();
    editor.destroy();
    if (GlobalRegistrator.isRegistered) GlobalRegistrator.unregister();
  });

  test('builds rich structure and creates three attributed proposals', async () => {
    const created = await runWriterTool(runtime, editor, 'create_document', {
      brief,
      title: 'Mutual NDA',
      blocks: [
        { text: 'Mutual NDA', style: 'Title' },
        { text: 'Company A and Company B', style: 'Subtitle' },
        { text: 'Purpose', style: 'Heading 1' },
        { text: 'The parties will evaluate a possible project.', style: 'Normal' },
        { text: 'Core obligations', style: 'Heading 2' },
        { text: 'Protect confidential information', style: 'Normal' },
        { text: 'Limit access to authorized staff', style: 'Normal' },
        { text: 'Return confidential materials', style: 'Normal' },
        { text: 'Confirm destruction in writing', style: 'Normal' },
        { text: '[Effective date]', style: 'Normal' },
        { text: '[Governing law]', style: 'Normal' },
        { text: 'Key dates', style: 'Heading 2' },
        { text: 'Confidentiality supports trusted collaboration.', style: 'Quote' },
      ],
    });
    expect(created.success).toBe(true);
    const creation = JSON.parse(created.output) as {
      paragraphs: { paragraphId: string; text: string }[];
    };
    const id = (text: string) =>
      creation.paragraphs.find((paragraph) => paragraph.text === text)!.paragraphId;

    const lists = await runWriterTool(runtime, editor, 'format_lists', {
      items: [
        { paragraphId: id('Protect confidential information'), kind: 'bullet' },
        { paragraphId: id('Limit access to authorized staff'), kind: 'bullet' },
        { paragraphId: id('Return confidential materials'), kind: 'numbered' },
        { paragraphId: id('Confirm destruction in writing'), kind: 'numbered' },
      ],
    });
    const controls = await runWriterTool(runtime, editor, 'insert_content_controls', {
      fields: [
        {
          paragraphId: id('[Effective date]'),
          tag: 'effective-date',
          title: 'Effective date',
        },
        {
          paragraphId: id('[Governing law]'),
          tag: 'governing-law',
          title: 'Governing law',
        },
      ],
    });
    const table = await runWriterTool(runtime, editor, 'insert_table', {
      beforeParagraphId: id('Key dates'),
      rows: [
        ['Milestone', 'Date'],
        ['Effective date', 'To be completed'],
      ],
    });
    const furniture = await runWriterTool(runtime, editor, 'write_header_footer', {
      header: 'Mutual NDA',
      footerPrefix: 'Page ',
    });
    expect([lists.success, controls.success, table.success, furniture.success]).toEqual([
      true,
      true,
      true,
      true,
    ]);

    const read = await runWriterTool(runtime, editor, 'read_document', {});
    const records = JSON.parse(read.output) as { id: string; text: string }[];
    expect(records).toHaveLength(17);
    expect(records.every((record) => /^[0-9A-F]{8}$/.test(record.id))).toBe(true);
    expect(records.map((record) => record.text)).toContain('Milestone');
    expect(records.map((record) => record.text)).toContain('To be completed');
    const purpose = records.find((record) => record.text.includes('possible project'));
    expect(purpose).toBeDefined();

    const replacement = await runWriterTool(runtime, editor, 'propose_replacement', {
      paragraphId: purpose!.id,
      search: 'possible project',
      replaceWith: 'potential transaction',
    });
    const insertion = await runWriterTool(runtime, editor, 'propose_insertion', {
      paragraphId: purpose!.id,
      after: 'evaluate',
      text: ' carefully',
    });
    const deletion = await runWriterTool(runtime, editor, 'propose_deletion', {
      paragraphId: purpose!.id,
      search: 'The parties ',
    });
    expect([replacement.success, insertion.success, deletion.success]).toEqual([true, true, true]);

    const revisions = await runtime.run(async (context) => {
      const collection = context.document.body.revisions;
      collection.load();
      await context.sync();
      for (const item of collection.items) item.load(['type', 'author']);
      await context.sync();
      return collection.items.map((item) => ({ type: item.type, author: item.author }));
    });
    expect(revisions.map((revision) => revision.type).sort()).toEqual([
      'Delete',
      'Insert',
      'Replace',
    ]);
    expect(revisions.every((revision) => revision.author === 'Writer agent')).toBe(true);
  });
});

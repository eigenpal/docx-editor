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

  test('replaces the seed and creates three attributed proposals', async () => {
    const created = await runWriterTool(runtime, editor, 'create_document', {
      brief,
      title: 'Mutual NDA',
      blocks: [
        { text: 'Mutual NDA', style: 'Title' },
        { text: 'Purpose', style: 'Heading 1' },
        { text: 'The parties will evaluate a possible project.', style: 'Normal' },
        { text: 'Protect confidential information', style: 'Normal', list: 'bullet' },
        { text: 'Return confidential materials', style: 'Normal', list: 'numbered' },
        { text: '[Governing law]', style: 'Normal', contentControl: true },
      ],
    });
    expect(created.success).toBe(true);

    const read = await runWriterTool(runtime, editor, 'read_document', {});
    const records = JSON.parse(read.output) as { id: string; text: string }[];
    expect(records).toHaveLength(6);
    expect(records.every((record) => /^[0-9A-F]{8}$/.test(record.id))).toBe(true);
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

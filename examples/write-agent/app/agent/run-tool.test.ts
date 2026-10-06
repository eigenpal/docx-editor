import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { reviewModule } from '@docx-editor.dev/pro';
import type { DocxEditorRuntime } from '@docx-editor.dev/editor-api/browser';
import { seedDocx } from '../seed-document';
import { createWriterRuntime, runWriterTool } from './run-tool';
import { DocxEditor } from '@docx-editor.dev/editor-api';

for (const change of ['text', 'formatting'] as const) {
  test(`writer refuses a replacement when ${change} changes between target reads`, async () => {
    const runtime = await DocxEditor.createServer(seedDocx());
    try {
      const read = await runWriterTool(runtime, null, 'read_document', {});
      expect(read.success).toBe(true);
      const target = JSON.parse(read.output).items[0];
      const run = runtime.run.bind(runtime);
      let injected = false;
      runtime.run = (async (
        callback: (
          context: import('@docx-editor.dev/editor-api').RequestContext
        ) => Promise<unknown>
      ) =>
        run(async (context) => {
          const sync = context.sync.bind(context);
          let reads = 0;
          context.sync = async () => {
            await sync();
            if (++reads === 2 && !injected) {
              injected = true;
              await run(async (other) => {
                const paragraph = other.document.body.paragraphs.getFirst();
                if (change === 'text') paragraph.insertText('User edit: ', 'Start');
                else paragraph.font.italic = true;
                await other.sync();
              });
            }
          };
          return callback(context);
        })) as typeof runtime.run;
      const result = await runWriterTool(runtime, null, 'edit_text', {
        edits: [
          {
            action: 'insertText',
            target: { paragraphId: target.id },
            location: 'Replace',
            text: 'Agent replacement',
          },
        ],
      });
      expect(injected).toBe(true);
      expect(result).toMatchObject({
        success: false,
        code: 'StaleDocument',
        recovery: { action: 'inspect' },
      });
      await run(async (c) => {
        c.document.body.load('text');
        await c.sync();
        if (change === 'text') expect(c.document.body.text).toContain('User edit: ');
        else {
          const font = c.document.body.paragraphs.getFirst().font;
          font.load('italic');
          await c.sync();
          expect(font.italic).toBe(true);
        }
        expect(c.document.body.text).not.toContain('Agent replacement');
      });
    } finally {
      runtime.dispose();
    }
  });
}

const brief = {
  documentType: 'mutual NDA',
  partiesOrAudience: 'Company A and Company B',
  purpose: 'evaluate a project',
  jurisdictionOrDomainRules: 'generic United States terms',
  tone: 'plain and balanced',
  length: 'two pages',
};

test('a stale refusal cannot be bypassed by repeating a whole-story edit', async () => {
  const runtime = await DocxEditor.createServer(seedDocx());
  try {
    expect((await runWriterTool(runtime, null, 'read_document', {})).success).toBe(true);
    await runtime.run(async (context) => {
      context.document.body.insertText('User draft', 'Replace');
      await context.sync();
    });
    const before = await runtime.save();
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await runWriterTool(runtime, null, 'write_story', {
        story: { kind: 'body' },
        text: 'Agent draft',
        location: 'Replace',
      });
      expect(result).toMatchObject({
        success: false,
        code: 'StaleDocument',
        recovery: { action: 'inspect' },
      });
      expect(await runtime.save()).toEqual(before);
    }
    expect((await runWriterTool(runtime, null, 'read_document', {})).success).toBe(true);
    expect(
      (
        await runWriterTool(runtime, null, 'write_story', {
          story: { kind: 'body' },
          text: 'Reconsidered draft',
          location: 'Replace',
        })
      ).success
    ).toBe(true);
  } finally {
    runtime.dispose();
  }
});

for (const afterFinalWrite of [false, true]) {
  test(`a user edit stops a progressive draft, final write ${afterFinalWrite}`, async () => {
    const runtime = await DocxEditor.createServer(seedDocx());
    const run = runtime.run.bind(runtime);
    let injected = false;
    runtime.run = (async (
      callback: (context: import('@docx-editor.dev/editor-api').RequestContext) => Promise<unknown>
    ) =>
      run(async (context) => {
        const sync = context.sync.bind(context);
        let reads = 0;
        context.sync = async () => {
          await sync();
          if (++reads === (afterFinalWrite ? 7 : 3) && !injected) {
            injected = true;
            await run(async (other) => {
              other.document.body.insertText('User draft', 'Start');
              await other.sync();
            });
          }
        };
        return callback(context);
      })) as typeof runtime.run;
    try {
      const result = await runWriterTool(runtime, null, 'create_document', {
        brief,
        title: 'Agent draft',
        blocks: [{ text: 'Agent draft', style: 'Title' }],
      });
      expect(injected).toBe(true);
      expect(result).toMatchObject({
        success: false,
        code: 'StaleDocument',
        recovery: { action: 'inspect' },
        completedSteps: afterFinalWrite
          ? ['clear body', 'paragraph', 'paragraph formatting']
          : ['clear body'],
      });
      await run(async (context) => {
        context.document.body.load('text');
        await context.sync();
        expect(context.document.body.text).toBe(
          afterFinalWrite ? 'User draftAgent draft' : 'User draft'
        );
      });
    } finally {
      runtime.dispose();
    }
  });
}

describe('writer agent browser tools', () => {
  let editor: DocxEditorInstance;
  let runtime: DocxEditorRuntime;
  let registered = false;

  beforeAll(() => {
    registered = !GlobalRegistrator.isRegistered;
    if (registered) GlobalRegistrator.register();
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
    if (registered) GlobalRegistrator.unregister();
  });

  test('builds rich structure and creates attributed proposals', async () => {
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
          search: '[Effective date]',
          tag: 'effective-date',
          title: 'Effective date',
        },
        {
          paragraphId: id('[Governing law]'),
          search: '[Governing law]',
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
    const secondTable = await runWriterTool(runtime, editor, 'insert_table', {
      beforeParagraphId: id('Key dates'),
      rows: [
        ['Owner', 'Status'],
        ['Legal team', 'Pending review'],
      ],
    });
    const furniture = await runWriterTool(runtime, editor, 'write_header_footer', {
      header: 'Mutual NDA',
      footerPrefix: 'Page ',
    });
    expect([
      lists.success,
      controls.success,
      table.success,
      secondTable.success,
      furniture.success,
    ]).toEqual([true, true, true, true, true]);

    const read = await runWriterTool(runtime, editor, 'read_document', {});
    const records = JSON.parse(read.output).items as { id: string; text: string }[];
    expect(records.filter((record) => record.text)).toHaveLength(21);
    expect(records.every((record) => /^[0-9A-F]{8}$/.test(record.id))).toBe(true);
    expect(records.map((record) => record.text)).toContain('Milestone');
    expect(records.map((record) => record.text)).toContain('To be completed');
    expect(records.map((record) => record.text)).toContain('Owner');
    expect(records.map((record) => record.text)).toContain('Pending review');
    const purpose = records.find((record) => record.text.includes('possible project'));
    expect(purpose).toBeDefined();

    const insertion = await runWriterTool(
      runtime,
      editor,
      'edit_text',
      {
        edits: [
          {
            action: 'insertText',
            target: { paragraphId: purpose!.id, search: 'evaluate' },
            text: ' carefully',
            location: 'After',
          },
        ],
      },
      'suggest'
    );
    const replacement = await runWriterTool(
      runtime,
      editor,
      'edit_text',
      {
        edits: [
          {
            action: 'insertText',
            target: { paragraphId: purpose!.id, search: 'possible project' },
            text: 'potential project',
            location: 'Replace',
          },
        ],
      },
      'suggest'
    );
    const deletion = await runWriterTool(
      runtime,
      editor,
      'edit_text',
      {
        edits: [{ action: 'delete', target: { paragraphId: purpose!.id, search: 'The parties ' } }],
      },
      'suggest'
    );
    expect(insertion.success, insertion.output).toBe(true);
    expect(replacement.success, replacement.output).toBe(true);
    expect(deletion.success, deletion.output).toBe(true);

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
      'Delete',
      'Insert',
      'Insert',
    ]);
    expect(revisions.every((revision) => revision.author === 'Writer agent')).toBe(true);
  });
  test('creates an SDT around field text without changing labels', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const local = createDocxEditor({ container, document: seedDocx() });
    const api = createWriterRuntime(local);
    try {
      const records = JSON.parse((await runWriterTool(api, local, 'read_document', {})).output)
        .items as {
        id: string;
        text: string;
      }[];
      const target = records.find((record) => record.text.includes('Example Client'))!;
      const result = await runWriterTool(api, local, 'insert_content_controls', {
        fields: [
          {
            paragraphId: target.id,
            search: 'Example Client',
            type: 'PlainText',
            tag: 'client',
            title: 'Client',
          },
        ],
      });
      expect(result.success).toBe(true);
      expect(
        JSON.parse((await runWriterTool(api, local, 'read_document', {})).output).items
      ).toEqual(records);
      await api.run(async (context) => {
        const controls = context.document.contentControls;
        controls.load('items');
        await context.sync();
        expect(controls.items).toHaveLength(1);
        controls.items[0]!.load(['text', 'tag', 'title']);
        await context.sync();
        expect(controls.items[0]!.text).toBe('Example Client');
        expect(controls.items[0]!.tag).toBe('client');
      });
      const rejected = await runWriterTool(api, local, 'insert_content_controls', {
        fields: [{ paragraphId: target.id, type: 'DropDownList', tag: 'date', title: 'Date' }],
      });
      expect(rejected.success).toBe(false);
    } finally {
      api.dispose();
      local.destroy();
      container.remove();
    }
  });
});

for (const tracking of ['Off', 'TrackMineOnly'] as const) {
  test(`capability discovery respects ${tracking} without changing it`, async () => {
    const runtime = await DocxEditor.createServer(seedDocx(), { author: 'Writer agent' });
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = tracking;
        await context.sync();
      });
      const result = await runWriterTool(runtime, null, 'discover_capabilities', {});
      expect(result.success).toBe(true);
      const capabilities = JSON.parse(result.output);
      expect(capabilities.mode).toBe(tracking === 'Off' ? 'direct' : 'suggest');
      expect(capabilities.controls.create).toEqual(['PlainText', 'RichText', 'DatePicker']);
      const selected = await runWriterTool(runtime, null, 'discover_capabilities', {}, 'suggest');
      expect(JSON.parse(selected.output).controls.create).toEqual([
        'PlainText',
        'RichText',
        'DatePicker',
      ]);
      await runtime.run(async (context) => {
        context.document.load('changeTrackingMode');
        await context.sync();
        expect(context.document.changeTrackingMode).toBe(tracking);
      });
    } finally {
      runtime.dispose();
    }
  });
}

test('browser writer creates a reviewable date control through the document API', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = createDocxEditor({ container, document: seedDocx(), modules: [reviewModule()] });
  const runtime = createWriterRuntime(editor);
  try {
    const read = await runWriterTool(runtime, editor, 'read_document', {});
    const target = JSON.parse(read.output).items.find((item: { text: string }) =>
      item.text.includes('Example Client')
    );
    const result = await runWriterTool(
      runtime,
      editor,
      'insert_content_controls',
      {
        fields: [
          {
            paragraphId: target.id,
            search: 'Example Client',
            type: 'DatePicker',
            tag: 'date',
            title: 'Date',
          },
        ],
      },
      'suggest'
    );
    expect(result.success, result.output).toBe(true);
    await runtime.run(async (c) => {
      c.document.body.revisions.load('items');
      c.document.contentControls.load('items');
      await c.sync();
      expect(c.document.body.revisions.items).toHaveLength(2);
      expect(c.document.contentControls.items).toHaveLength(1);
      for (const revision of c.document.body.revisions.items) revision.reject();
      await c.sync();
      c.document.contentControls.load('items');
      c.document.body.load('text');
      await c.sync();
      expect(c.document.contentControls.items).toHaveLength(0);
      expect(c.document.body.text).toContain('Example Client');
    });
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    await runtime.run(async (c) => {
      c.document.contentControls.load('items');
      await c.sync();
      expect(c.document.contentControls.items).toHaveLength(1);
    });
    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    await runtime.run(async (c) => {
      c.document.contentControls.load('items');
      await c.sync();
      expect(c.document.contentControls.items).toHaveLength(0);
    });
  } finally {
    runtime.dispose();
    editor.destroy();
    container.remove();
  }
});

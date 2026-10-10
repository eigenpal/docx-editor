import { expect, test } from 'bun:test';
import { DocxEditor, type DocxEditorServerRuntime } from '@docx-editor.dev/editor-api';
import { anonymousStories } from './paragraph-targets.fixture';
import { runWriterTool, type WriterMode } from './run-tool';

const story = { kind: 'header', section: 0, variant: 'Primary' };
async function inspect(runtime: DocxEditorServerRuntime, area = 'paragraphs') {
  const result = await runWriterTool(runtime, null, 'inspect_document', { story, area });
  expect(result.success, result.output).toBe(true);
  return JSON.parse(result.output).items;
}
async function edit(runtime: DocxEditorServerRuntime, id: string, mode: WriterMode = 'direct') {
  return runWriterTool(
    runtime,
    null,
    'edit_text',
    {
      story,
      edits: [
        {
          action: 'insertText',
          target: { paragraphId: id, search: 'Draft' },
          text: 'Approved',
          location: 'Replace',
        },
      ],
    },
    mode
  );
}
async function header(runtime: DocxEditorServerRuntime) {
  return runtime.run(async (context) => {
    const sections = context.document.sections;
    sections.load('items');
    await context.sync();
    const body = sections.items[0]!.getHeader('Primary');
    body.load('text');
    await context.sync();
    return body.text;
  });
}
for (const mode of ['direct', 'suggest'] as const) {
  test(`targets imported header paragraphs in ${mode} mode`, async () => {
    const runtime = await DocxEditor.createServer(anonymousStories(), {
      author: 'Writer agent',
      revisionTextView: 'original',
    });
    try {
      const rows = await inspect(runtime);
      expect(rows[0].id).toMatch(/^@writer:/);
      expect(new Set(rows.map((p: { id: string }) => p.id)).size).toBe(rows.length);
      const result = await edit(runtime, rows[0].id, mode);
      expect(result.success, result.output).toBe(true);
      const reopened = await DocxEditor.createServer(await runtime.save());
      try {
        if (mode === 'suggest')
          await reopened.run(async (context) => {
            const sections = context.document.sections;
            sections.load('items');
            await context.sync();
            const body = sections.items[0]!.getHeader('Primary');
            await context.sync();
            body.revisions.load('items');
            await context.sync();
            expect(body.revisions.items.length).toBeGreaterThan(0);
            body.revisions.acceptAll();
            await context.sync();
          });
        expect(await header(reopened)).toStartWith('Approved header');
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
}

test('distinguishes identical paragraphs and expires inspection tokens after an edit', async () => {
  const runtime = await DocxEditor.createServer(anonymousStories());
  try {
    const rows = await inspect(runtime);
    const result = await runWriterTool(
      runtime,
      null,
      'format_document',
      {
        story,
        targets: [{ paragraphId: rows[2].id }],
        changes: [{ property: 'bold', value: true }],
      },
      'direct'
    );
    expect(result.success, result.output).toBe(true);
    const fresh = await inspect(runtime);
    expect(fresh[1].font.bold).not.toBe(true);
    expect(fresh[2].font.bold).toBe(true);
    expect((await edit(runtime, rows[0].id)).success).toBe(false);
    expect((await edit(runtime, fresh[0].id)).success).toBe(false); // The refusal requires fresh inspection.
    const current = await inspect(runtime);
    expect((await edit(runtime, current[0].id)).success).toBe(true);
  } finally {
    runtime.dispose();
  }
});

for (const area of ['tables', 'lists']) {
  test(`formats imported header paragraphs from ${area} inspection`, async () => {
    const runtime = await DocxEditor.createServer(anonymousStories());
    try {
      const records = await inspect(runtime, area);
      const target =
        area === 'tables' ? records[0].cells[1].paragraphs[0] : records[0].paragraphs[1];
      expect(target.id).toMatch(/^@writer:/);
      const result = await runWriterTool(
        runtime,
        null,
        'format_document',
        {
          story,
          targets: [{ paragraphId: target.id }],
          changes: [{ property: 'italic', value: true }],
        },
        'direct'
      );
      expect(result.success, result.output).toBe(true);
      const rows = await inspect(runtime);
      expect(rows.find((p: { text: string }) => p.text === target.text).font.italic).toBe(true);
    } finally {
      runtime.dispose();
    }
  });
}

test('refuses inspection targets after an external edit', async () => {
  const runtime = await DocxEditor.createServer(anonymousStories());
  try {
    const rows = await inspect(runtime);
    await runtime.run(async (context) => {
      context.document.body.insertParagraph('External change', 'End');
      await context.sync();
    });
    const result = await edit(runtime, rows[0].id);
    expect(result.success).toBe(false);
    expect(result.code).toBe('StaleDocument');
    expect(await header(runtime)).toStartWith('Draft header');
  } finally {
    runtime.dispose();
  }
});

test('keeps an inspected footer target after a header-only text edit', async () => {
  const runtime = await DocxEditor.createServer(anonymousStories());
  try {
    const headers = await inspect(runtime);
    const footerStory = { kind: 'footer', section: 0, variant: 'Primary' };
    const result = await runWriterTool(runtime, null, 'inspect_document', {
      story: footerStory,
      area: 'paragraphs',
    });
    expect(result.success).toBe(true);
    const target = JSON.parse(result.output).items[0];
    expect((await edit(runtime, headers[0].id)).success).toBe(true);
    const changed = await runWriterTool(
      runtime,
      null,
      'edit_text',
      {
        story: footerStory,
        edits: [
          {
            action: 'insertText',
            target: { paragraphId: target.id },
            text: '2027',
            location: 'Replace',
          },
        ],
      },
      'direct'
    );
    expect(changed.success, changed.output).toBe(true);
  } finally {
    runtime.dispose();
  }
});

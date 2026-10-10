import { expect, test } from 'bun:test';
import { DocxEditor, type ClientObject, type RunCallback } from '@docx-editor.dev/editor-api';
import { noteFixture } from './note-test-support';
import { runWriterTool } from './run-tool';
import { stateFor } from './document-access';

for (const mode of ['direct', 'suggest'] as const) {
  test(`inspection batch registers body and note targets in ${mode}`, async () => {
    const runtime = await DocxEditor.createServer(noteFixture(), { author: 'Writer' });
    try {
      const result = await runWriterTool(
        runtime,
        null,
        'inspect_document_batch',
        {
          requests: [
            { area: 'paragraphs', limit: 10 },
            { area: 'tables', limit: 10 },
            { area: 'paragraphs', story: { kind: 'footnote', noteIndex: 0 }, limit: 10 },
          ],
        },
        mode
      );
      expect(result.success, result.output).toBe(true);
      const results = JSON.parse(result.output).results;
      expect(results.map((r: { requestIndex: number }) => r.requestIndex)).toEqual([0, 1, 2]);
      expect(results[1].data.items[0].cells).toHaveLength(1);
      const note = results[2].data;
      const edit = await runWriterTool(
        runtime,
        null,
        'edit_text',
        {
          story: note.story,
          edits: [
            {
              action: 'insertText',
              target: { paragraphId: note.items[0].id, search: 'note' },
              location: 'Replace',
              text: 'citation',
            },
          ],
        },
        mode
      );
      expect(edit.success, edit.output).toBe(true);
    } finally {
      runtime.dispose();
    }
  });
}

test('inspection batch refuses excessive requests and clears partial targets on failure', async () => {
  const runtime = await DocxEditor.createServer(noteFixture());
  try {
    const invalid = await runWriterTool(runtime, null, 'inspect_document_batch', {
      requests: Array.from({ length: 7 }, () => ({ area: 'paragraphs', limit: 1 })),
    });
    expect(invalid.code).toBe('InvalidArgument');
    const partial = await runWriterTool(runtime, null, 'inspect_document_batch', {
      requests: [
        { area: 'paragraphs', limit: 10 },
        { area: 'footnotes', story: { kind: 'footnote', noteIndex: 0 }, limit: 10 },
      ],
    });
    expect(partial.success).toBe(false);
    expect(stateFor(runtime).paragraphs.size).toBe(0);
    expect(stateFor(runtime).inspected.size).toBe(0);
  } finally {
    runtime.dispose();
  }
});

test('inspection batch rejects an external edit between inspections', async () => {
  const runtime = await DocxEditor.createServer(noteFixture());
  const original = runtime.run.bind(runtime);
  let changed = false;
  runtime.run = async <T>(
    first: RunCallback<T> | ClientObject | readonly ClientObject[],
    second?: RunCallback<T>
  ): Promise<T> => {
    const result =
      typeof first === 'function' ? await original(first) : await original(first, second!);
    if (!changed) {
      changed = true;
      await original(async (context) => {
        context.document.body.insertParagraph('External edit', 'End');
        await context.sync();
      });
    }
    return result;
  };
  try {
    const result = await runWriterTool(runtime, null, 'inspect_document_batch', {
      requests: [
        { area: 'paragraphs', limit: 10 },
        { area: 'tables', limit: 10 },
      ],
    });
    expect(result.code).toBe('StaleDocument');
    expect(stateFor(runtime).paragraphs.size).toBe(0);
    expect(stateFor(runtime).inspected.size).toBe(0);
  } finally {
    runtime.dispose();
  }
});

test('inspection batch bounds aggregate items and serialized results', async () => {
  const runtime = await DocxEditor.createServer(noteFixture());
  try {
    const excessive = await runWriterTool(runtime, null, 'inspect_document_batch', {
      requests: Array.from({ length: 4 }, () => ({ area: 'paragraphs', limit: 40 })),
    });
    expect(excessive.code).toBe('InvalidArgument');
    await runtime.run(async (context) => {
      context.document.body.insertParagraph('x'.repeat(210_000), 'Start');
      await context.sync();
    });
    const oversized = await runWriterTool(runtime, null, 'inspect_document_batch', {
      requests: [{ area: 'paragraphs', limit: 1 }],
    });
    expect(oversized.code).toBe('ResultTooLarge');
    expect(oversized.output).toContain('120,000 UTF-8 bytes');
    expect(stateFor(runtime).paragraphs.size).toBe(0);
  } finally {
    runtime.dispose();
  }
});

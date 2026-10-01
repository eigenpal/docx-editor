import { expect, test } from 'bun:test';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { seedDocx } from '../seed-document';
import { runWriterTool } from './run-tool';

for (const mode of ['direct', 'suggest'] as const) {
  test(`delete then reuse refuses before changing the document in ${mode}`, async () => {
    const runtime = await DocxEditor.createServer(seedDocx(), { author: 'Writer' });
    try {
      const read = await runWriterTool(runtime, null, 'read_document', {});
      const paragraph = JSON.parse(read.output).items[0];
      const result = await runWriterTool(
        runtime,
        null,
        'edit_text',
        {
          edits: [
            { action: 'deleteParagraph', paragraphId: paragraph.id },
            {
              action: 'insertParagraph',
              target: { paragraphId: paragraph.id },
              location: 'After',
              text: 'Replacement',
            },
          ],
        },
        mode
      );
      expect(result.success).toBe(false);
      expect(result.code).toBe('InvalidArgument');
      expect(result.completedSteps).toEqual([]);
      const after = await runWriterTool(runtime, null, 'read_document', {});
      expect(JSON.parse(after.output).items.map((p: { text: string }) => p.text)).toEqual(
        JSON.parse(read.output).items.map((p: { text: string }) => p.text)
      );
      const revisions = await runWriterTool(runtime, null, 'inspect_document', {
        area: 'revisions',
      });
      expect(JSON.parse(revisions.output).items).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });
}

test('deletion preflight refuses overlapping imported inspection aliases', async () => {
  const { anonymousStories } = await import('./paragraph-targets.fixture');
  const runtime = await DocxEditor.createServer(anonymousStories());
  const story = { kind: 'header', section: 0, variant: 'Primary' };
  try {
    const body = await runWriterTool(runtime, null, 'read_document', { story });
    const table = await runWriterTool(runtime, null, 'inspect_document', { area: 'lists', story });
    const cell = JSON.parse(table.output).items[0].paragraphs[0];
    const paragraph = JSON.parse(body.output).items.find(
      (p: { text: string }) => p.text === cell.text
    );
    expect(paragraph.id).not.toBe(cell.id);
    const result = await runWriterTool(
      runtime,
      null,
      'edit_text',
      {
        story,
        edits: [
          { action: 'deleteParagraph', paragraphId: paragraph.id },
          {
            action: 'insertText',
            target: { paragraphId: cell.id },
            location: 'Start',
            text: 'Unsafe ',
          },
        ],
      },
      'direct'
    );
    expect(result.code).toBe('AmbiguousTarget');
    expect(result.completedSteps).toEqual([]);
    const after = await runWriterTool(runtime, null, 'read_document', { story });
    expect(JSON.parse(after.output).items.map((p: { text: string }) => p.text)).toEqual(
      JSON.parse(body.output).items.map((p: { text: string }) => p.text)
    );
  } finally {
    runtime.dispose();
  }
});

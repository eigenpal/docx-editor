import { expect, test } from 'bun:test';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { anonymousStories } from './paragraph-targets.fixture';
import { noteFixture } from './note-test-support';
import { runWriterTool } from './run-tool';
import { WriterInputStream } from './stream-input';
import { WriterStreamEdits } from './stream-edits';

for (const kind of ['header', 'footer', 'footnote', 'endnote'] as const) {
  test(`story after edits waits for complete ${kind} input`, async () => {
    const runtime = await DocxEditor.createServer(
      kind.endsWith('note') ? noteFixture() : anonymousStories()
    );
    const story = {
      kind,
      section: 0,
      variant: 'Primary',
      ...(kind.endsWith('note') ? { noteIndex: 0 } : {}),
    };
    try {
      const before = await runWriterTool(runtime, null, 'read_document', { story });
      const paragraph = JSON.parse(before.output).items[0];
      const input = {
        edits: [
          {
            action: 'insertText',
            target: { paragraphId: paragraph.id },
            location: 'Start',
            text: 'Updated ',
          },
        ],
        story,
      };
      const parser = new WriterInputStream('edit_text');
      const parts = parser.push(JSON.stringify(input));
      expect(parts).toEqual([]);
      const stream = new WriterStreamEdits((name, args) =>
        runWriterTool(runtime, null, name, args, 'direct')
      );
      expect(await stream.finish('call', 'edit_text', input)).toBeUndefined();
      const result = await runWriterTool(runtime, null, 'edit_text', input, 'direct');
      expect(result.success, result.output).toBe(true);
      const after = await runWriterTool(runtime, null, 'read_document', { story });
      expect(JSON.parse(after.output).items[0].text).toBe(`Updated ${paragraph.text}`);
    } finally {
      runtime.dispose();
    }
  });
}

test('explicit body metadata permits progressive edits; omitted story retains full-input defaults', () => {
  const edits = [
    {
      action: 'insertText',
      target: { paragraphId: 'target' },
      location: 'Start',
      text: 'Updated ',
    },
  ];
  expect(
    new WriterInputStream('edit_text').push(JSON.stringify({ story: { kind: 'body' }, edits }))
  ).toHaveLength(1);
  expect(new WriterInputStream('edit_text').push(JSON.stringify({ edits }))).toEqual([]);
});

test('content control streaming also waits for explicit story metadata', () => {
  const fields = [
    { paragraphId: 'target', search: 'name', type: 'PlainText', title: 'Name', tag: 'name' },
  ];
  expect(
    new WriterInputStream('insert_content_controls').push(
      JSON.stringify({ fields, story: { kind: 'header' } })
    )
  ).toEqual([]);
});

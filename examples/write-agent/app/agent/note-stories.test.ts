import { expect, test } from 'bun:test';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { strFromU8, unzipSync } from 'fflate';
import { noteFixture } from './note-test-support';
import { runWriterTool } from './run-tool';

for (const mode of ['direct', 'suggest'] as const) {
  test(`writer edits referenced notes with ${mode} mode`, async () => {
    const runtime = await DocxEditor.createServer(noteFixture(), { author: 'Writer' });
    try {
      for (const area of ['footnotes', 'endnotes']) {
        const listing = await runWriterTool(runtime, null, 'inspect_document', { area }, mode);
        expect(listing.success).toBe(true);
        const note = JSON.parse(listing.output).items[0];
        expect(note.text).toContain(area === 'footnotes' ? 'Body note' : 'End note');
        const read = await runWriterTool(
          runtime,
          null,
          'read_document',
          { story: note.story },
          mode
        );
        expect(read.success).toBe(true);
        const paragraph = JSON.parse(read.output).items[0];
        const edit = await runWriterTool(
          runtime,
          null,
          'edit_text',
          {
            story: note.story,
            edits: [
              {
                action: 'insertText',
                target: { paragraphId: paragraph.id, search: 'note' },
                text: 'citation',
                location: 'Replace',
              },
            ],
          },
          mode
        );
        expect(edit.success, edit.output).toBe(true);
      }
      const bytes = await runtime.save();
      const reopened = await DocxEditor.createServer(bytes);
      try {
        const parts = unzipSync(await reopened.save());
        expect(strFromU8(parts['word/document.xml']!)).toContain('Body');
        expect(strFromU8(parts['word/footnotes.xml']!)).toContain('Cell note');
        expect(strFromU8(parts['word/footnotes.xml']!)).toContain('citation');
        expect(strFromU8(parts['word/endnotes.xml']!)).toContain('citation');
        if (mode === 'suggest') expect(strFromU8(parts['word/footnotes.xml']!)).toContain('<w:ins');
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
}
test('Body note collections follow references and cell scope', async () => {
  const runtime = await DocxEditor.createServer(noteFixture());
  try {
    await runtime.run(async (context) => {
      const notes = context.document.body.footnotes;
      const tables = context.document.body.tables;
      notes.load('items');
      tables.load('items');
      await context.sync();
      const cellNotes = tables.items[0]!.getCell(0, 0).body.footnotes;
      cellNotes.load('items');
      for (const note of notes.items) note.load('text');
      await context.sync();
      expect(notes.items.map((n) => n.text.trim())).toEqual(['Body note', 'Cell note']);
      for (const note of cellNotes.items) note.load('text');
      await context.sync();
      expect(cellNotes.items.map((n) => n.text.trim())).toEqual(['Cell note']);
    });
  } finally {
    runtime.dispose();
  }
});

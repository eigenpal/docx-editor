/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { DocxEditor } from '../../index.ts';
import { noteFixture } from './note-test-support.ts';
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

test('Body note collections omit removed references after note deletion', async () => {
  const runtime = await DocxEditor.createServer(noteFixture(), { author: 'Writer' });
  try {
    await runtime.run(async (context) => {
      const notes = context.document.body.footnotes;
      notes.load('items');
      await context.sync();
      notes.items[0]!.delete();
      await context.sync();
    });
    await runtime.run(async (context) => {
      const notes = context.document.body.footnotes;
      notes.load('items');
      await context.sync();
      for (const note of notes.items) note.load('text');
      await context.sync();
      expect(notes.items.map((note) => note.text.trim())).toEqual(['Cell note']);
    });
  } finally {
    runtime.dispose();
  }
});

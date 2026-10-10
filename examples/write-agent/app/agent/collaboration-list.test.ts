import { afterAll, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { writeOoxmlPackage } from '@docx-editor.dev/core/store';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { collaborationModule, reviewModule } from '@docx-editor.dev/pro';
import { createPeerHarness } from '../../../../packages/pro/src/collaboration/__tests__/document-peer-support';
import { seedDocx } from '../seed-document';
import { createWriterRuntime, runWriterTool } from './run-tool';
const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

test('concurrent list membership suggestions converge and reject after reopen', async () => {
  const baseline = await DocxEditor.createServer(seedDocx());
  let bytes: Uint8Array;
  try {
    await baseline.run(async (c) => {
      c.document.body.paragraphs.load('items');
      await c.sync();
      const list = c.document.body.paragraphs.items[1]!.startNewList();
      await c.sync();
      list.load('id');
      await c.sync();
      c.document.body.paragraphs.items[2]!.attachToList(list.id, 0);
      await c.sync();
    });
    bytes = await baseline.save();
  } finally {
    baseline.dispose();
  }
  const harness = createPeerHarness('writer-list-review', { offlineEditing: true });
  const peers = await harness.pair(bytes);
  const mounted = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    return { editor, runtime: createWriterRuntime(editor), container, room: peer.room };
  });
  try {
    const reads = await Promise.all(
      mounted.map((peer) => runWriterTool(peer.runtime, peer.editor, 'read_document', {}))
    );
    peers.pause();
    for (const [i, peer] of mounted.entries()) {
      const rows = JSON.parse(reads[i]!.output).items;
      const result = await runWriterTool(
        peer.runtime,
        peer.editor,
        'edit_list',
        {
          paragraphIds: [rows[i + 1].id],
          operation: i === 0 ? { action: 'detach' } : { action: 'level', level: 1 },
        },
        'suggest'
      );
      expect(result.success, result.output).toBe(true);
    }
    peers.resume();
    for (const peer of mounted) peer.room.session.flushPendingJournals();
    for (const peer of mounted) {
      const saved = await DocxEditor.createServer(new Uint8Array(await peer.editor.save()));
      try {
        await saved.run(async (c) => {
          c.document.revisions.load('items');
          await c.sync();
          expect(c.document.revisions.items).toHaveLength(2);
          c.document.body.revisions.rejectAll();
          await c.sync();
          c.document.body.lists.load('items');
          await c.sync();
          expect(c.document.body.lists.items).toHaveLength(1);
          const paragraphs = c.document.body.lists.items[0]!.paragraphs;
          paragraphs.load('items');
          await c.sync();
          expect(paragraphs.items).toHaveLength(2);
        });
      } finally {
        saved.dispose();
      }
    }
  } finally {
    for (const peer of mounted) {
      peer.runtime.dispose();
      peer.editor.destroy();
      peer.container.remove();
    }
    harness.cleanup();
  }
});

test('concurrent paragraph suggestions converge and reject after reopen', async () => {
  const harness = createPeerHarness('writer-paragraph-review', { offlineEditing: true });
  const peers = await harness.pair(seedDocx());
  const mounted = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    return { editor, runtime: createWriterRuntime(editor), container, room: peer.room };
  });
  try {
    peers.pause();
    for (const [index, peer] of mounted.entries()) {
      await peer.runtime.run(async (context) => {
        context.document.body.paragraphs.load('items');
        await context.sync();
        context.document.changeTrackingMode = 'TrackMineOnly';
        const added = context.document.body.paragraphs.items[index * 2]!.insertParagraph(
          `Proposed paragraph ${index}`,
          'After'
        );
        await context.sync();
        added.font.italic = true;
        added.spaceAfter = 10;
        await context.sync();
      });
      peer.room.session.flushPendingJournals();
    }
    peers.resume();
    for (const peer of mounted) peer.room.session.flushPendingJournals();
    for (const peer of mounted) {
      const bytes = new Uint8Array(await peer.editor.save());
      const xml = strFromU8(unzipSync(bytes)['word/document.xml']!);
      expect(xml).toContain('Proposed paragraph 0');
      expect(xml).toContain('Proposed paragraph 1');
      const saved = await DocxEditor.createServer(bytes);
      try {
        await saved.run(async (context) => {
          context.document.body.revisions.rejectAll();
          await context.sync();
          context.document.body.load('text');
          context.document.body.paragraphs.load('items');
          await context.sync();
          expect(context.document.body.text).not.toContain('Proposed paragraph');
          expect(context.document.body.paragraphs.items).toHaveLength(5);
        });
      } finally {
        saved.dispose();
      }
    }
  } finally {
    for (const peer of mounted) {
      peer.runtime.dispose();
      peer.editor.destroy();
      peer.container.remove();
    }
    harness.cleanup();
  }
});

test('creates a list after inserting paragraphs in a collaboration room', async () => {
  const harness = createPeerHarness('writer-new-list', { offlineEditing: true });
  const peers = await harness.pair(seedDocx());
  peers.alice.detach();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = createDocxEditor({
    container,
    document: peers.alice.room.document,
    modules: [reviewModule(), collaborationModule({ session: peers.alice.room.session })],
  });
  const runtime = createWriterRuntime(editor);
  try {
    await runtime.run(async (c) => {
      c.document.body.clear();
      await c.sync();
      c.document.body.insertText('Draft title', 'Start');
      await c.sync();
      const paragraph = c.document.body.insertParagraph('New list item', 'End');
      await c.sync();
      const list = paragraph.startNewList();
      await c.sync();
      list.load('id');
      await c.sync();
      list.setLevelNumbering(0, 'Arabic', [0, '.']);
      await c.sync();
    });
    peers.alice.room.session.flushPendingJournals();
    for (const bytes of [
      new Uint8Array(await editor.save()),
      writeOoxmlPackage(peers.bob.store.currentPackage()),
    ]) {
      const saved = await DocxEditor.createServer(bytes);
      try {
        await saved.run(async (c) => {
          c.document.body.lists.load('items');
          await c.sync();
          expect(c.document.body.lists.items).toHaveLength(1);
        });
      } finally {
        saved.dispose();
      }
    }
  } finally {
    runtime.dispose();
    editor.destroy();
    container.remove();
    harness.cleanup();
  }
});

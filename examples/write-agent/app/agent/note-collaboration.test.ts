import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule, reviewModule } from '@docx-editor.dev/pro';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import { packageFingerprint } from '../../../../packages/pro/src/collaboration/__tests__/document-support';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { createPeerHarness } from '../../../../packages/pro/src/collaboration/__tests__/document-peer-support';
import { noteFixture } from './note-test-support';
import { createWriterRuntime, runWriterTool } from './run-tool';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

for (const mode of ['direct', 'suggest'] as const) {
  test(`note edits synchronize and survive save/reopen in ${mode}`, async () => {
    const harness = createPeerHarness(`writer-note-${mode}`, { offlineEditing: true });
    const peers = await harness.pair(noteFixture());
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
      const a = mounted[0]!;
      const story = { kind: 'footnote', noteIndex: 0 };
      const read = await runWriterTool(a.runtime, a.editor, 'read_document', { story });
      expect(read.success, read.output).toBe(true);
      const target = JSON.parse(read.output).items[0];
      const result = await runWriterTool(
        a.runtime,
        a.editor,
        'edit_text',
        {
          story,
          edits: [
            {
              action: 'insertText',
              target: { paragraphId: target.id, search: 'note' },
              location: 'Replace',
              text: 'citation',
            },
          ],
        },
        mode
      );
      expect(result.success, JSON.stringify(result)).toBe(true);
      for (const peer of mounted) peer.room.session.flushPendingJournals();
      expect(a.room.session.undo()).toBe(true);
      for (const peer of mounted) peer.room.session.flushPendingJournals();
      expect(a.room.session.redo()).toBe(true);
      for (const peer of mounted) peer.room.session.flushPendingJournals();
      peers.pause();
      for (const [index, peer] of mounted.entries()) {
        const snapshot = await runWriterTool(peer.runtime, peer.editor, 'read_document', { story });
        expect(snapshot.success, snapshot.output).toBe(true);
        const paragraph = JSON.parse(snapshot.output).items[0];
        const concurrent = await runWriterTool(
          peer.runtime,
          peer.editor,
          'edit_text',
          {
            story,
            edits: [
              {
                action: 'insertText',
                target: { paragraphId: paragraph.id },
                text: index === 0 ? 'Left ' : 'Right ',
                location: 'Start',
              },
            ],
          },
          mode
        );
        expect(concurrent.success, concurrent.output).toBe(true);
        peer.room.session.flushPendingJournals();
      }
      peers.resume();
      for (const peer of mounted) peer.room.session.flushPendingJournals();
      const values = [];
      for (const peer of mounted) {
        const reopened = await DocxEditor.createServer(new Uint8Array(await peer.editor.save()));
        try {
          values.push(
            await reopened.run(async (context) => {
              if (mode === 'suggest') {
                context.document.body.footnotes.load('items');
                await context.sync();
                const body = context.document.body.footnotes.items[0]!.body;
                body.load('text');
                await context.sync();
                body.revisions.acceptAll();
                await context.sync();
              }
              const notes = context.document.body.footnotes;
              notes.load('items');
              await context.sync();
              notes.items[0]!.load('text');
              await context.sync();
              return notes.items[0]!.text;
            })
          );
        } finally {
          reopened.dispose();
        }
      }
      expect(values[0]).toContain('Body citation');
      expect(values[0]).toContain('Left ');
      expect(values[0]).toContain('Right ');
      expect(values[1]).toBe(values[0]);
    } finally {
      for (const peer of mounted) {
        peer.runtime.dispose();
        peer.editor.destroy();
        peer.container.remove();
      }
      harness.cleanup();
    }
  });
}

test('note deletion wins concurrent text edits and survives reconnect', async () => {
  const harness = createPeerHarness('writer-note-delete', { offlineEditing: true });
  const peers = await harness.pair(noteFixture());
  const mount = (peer: typeof peers.alice) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    return { editor, runtime: createWriterRuntime(editor), container };
  };
  const mounted = [mount(peers.alice), mount(peers.bob)];
  const close = (value: (typeof mounted)[number]) => {
    value.runtime.dispose();
    value.editor.destroy();
    value.container.remove();
  };
  try {
    const story = { kind: 'footnote', noteIndex: 0 };
    const snapshot = await runWriterTool(mounted[1]!.runtime, mounted[1]!.editor, 'read_document', {
      story,
    });
    expect(snapshot.success, snapshot.output).toBe(true);
    const target = JSON.parse(snapshot.output).items[0];
    peers.pause();
    await mounted[0]!.runtime.run(async (context) => {
      const notes = context.document.body.footnotes;
      notes.load('items');
      await context.sync();
      notes.items[0]!.delete();
      await context.sync();
    });
    peers.alice.room.session.flushPendingJournals();
    const edit = await runWriterTool(
      mounted[1]!.runtime,
      mounted[1]!.editor,
      'edit_text',
      {
        story,
        edits: [
          {
            action: 'insertText',
            target: { paragraphId: target.id },
            location: 'Start',
            text: 'Concurrent ',
          },
        ],
      },
      'direct'
    );
    expect(edit.success, edit.output).toBe(true);
    peers.bob.room.session.flushPendingJournals();
    peers.resume();
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();

    const fingerprint = async (peer: (typeof mounted)[number]) => {
      const loaded = readOoxmlPackage(new Uint8Array(await peer.editor.save()));
      if (!loaded.ok) throw new Error(loaded.reason);
      return packageFingerprint(loaded.package);
    };
    const beforeReconnect = await fingerprint(mounted[0]!);
    expect(await fingerprint(mounted[1]!)).toBe(beforeReconnect);
    close(mounted.pop()!);
    const reconnected = await harness.remount(peers.bob);
    mounted.push(mount(reconnected));
    expect(await fingerprint(mounted[1]!)).toBe(beforeReconnect);

    for (const peer of mounted) {
      const reopened = await DocxEditor.createServer(new Uint8Array(await peer.editor.save()));
      try {
        await reopened.run(async (context) => {
          const notes = context.document.body.footnotes;
          notes.load('items');
          await context.sync();
          for (const note of notes.items) note.load('text');
          await context.sync();
          expect(notes.items.map((note) => note.text.trim())).toEqual(['Cell note']);
        });
      } finally {
        reopened.dispose();
      }
    }
  } finally {
    for (const peer of mounted) close(peer);
    harness.cleanup();
  }
});

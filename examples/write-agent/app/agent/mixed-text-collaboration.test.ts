import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule, reviewModule } from '@docx-editor.dev/pro';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { createPeerHarness } from '../../../../packages/pro/src/collaboration/__tests__/document-peer-support';
import { seedDocx } from '../seed-document';
import { createWriterRuntime, runWriterTool } from './run-tool';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

for (const mode of ['direct', 'suggest'] as const) {
  test(`mixed edits synchronize and survive save/reopen in ${mode}`, async () => {
    const harness = createPeerHarness(`writer-mixed-${mode}`, { offlineEditing: true });
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
      const a = mounted[0]!;
      const read = await runWriterTool(a.runtime, a.editor, 'read_document', {});
      const target = JSON.parse(read.output).items[0];
      const result = await runWriterTool(
        a.runtime,
        a.editor,
        'edit_text',
        {
          edits: [
            {
              action: 'insertText',
              target: { paragraphId: target.id, search: 'Draft' },
              location: 'Replace',
              text: 'Final',
            },
            ...['A', 'B'].map((text) => ({
              action: 'insertParagraph',
              target: { paragraphId: target.id },
              location: 'After',
              text,
            })),
          ],
        },
        mode
      );
      expect(result.success, JSON.stringify(result)).toBe(true);
      for (const peer of mounted) peer.room.session.flushPendingJournals();
      const values = [];
      for (const peer of mounted) {
        const reopened = await DocxEditor.createServer(new Uint8Array(await peer.editor.save()));
        try {
          values.push(
            await reopened.run(async (context) => {
              if (mode === 'suggest') {
                context.document.body.revisions.acceptAll();
                await context.sync();
              }
              context.document.body.load('text');
              await context.sync();
              return context.document.body.text;
            })
          );
        } finally {
          reopened.dispose();
        }
      }
      expect(values[0]).toStartWith('Final project proposal\rA\rB');
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

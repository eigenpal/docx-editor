import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule, reviewModule } from '@docx-editor.dev/pro';
import { DocxEditor } from '@docx-editor.dev/editor-api';
import { createPeerHarness } from '../../../../packages/pro/src/collaboration/__tests__/document-peer-support';
import { anonymousStories } from './paragraph-targets.fixture';
import { createWriterRuntime, runWriterTool } from './run-tool';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

const header = { kind: 'header', section: 0, variant: 'Primary' };
const footer = { kind: 'footer', section: 0, variant: 'Primary' };

test('imported story targets synchronize through real sessions', async () => {
  const harness = createPeerHarness('writer-imported-stories', { offlineEditing: true });
  const peers = await harness.pair(anonymousStories());
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
  const a = mounted[0]!,
    b = mounted[1]!;
  function flush() {
    for (const peer of mounted) peer.room.session.flushPendingJournals();
  }
  async function read(peer: typeof a, story = header) {
    const result = await runWriterTool(peer.runtime, peer.editor, 'inspect_document', {
      story,
      area: 'paragraphs',
    });
    expect(result.success, result.output).toBe(true);
    return JSON.parse(result.output).items as { id: string; text: string }[];
  }
  async function replace(
    peer: typeof a,
    story: typeof header,
    id: string,
    search: string,
    text: string,
    mode: 'direct' | 'suggest' = 'suggest'
  ) {
    const result = await runWriterTool(
      peer.runtime,
      peer.editor,
      'edit_text',
      {
        story,
        edits: [
          { action: 'insertText', target: { paragraphId: id, search }, text, location: 'Replace' },
        ],
      },
      mode
    );
    expect(result.success, result.output).toBe(true);
  }
  async function saved(peer: typeof a) {
    const runtime = await DocxEditor.createServer(new Uint8Array(await peer.editor.save()));
    try {
      return await runtime.run(async (context) => {
        const sections = context.document.sections;
        sections.load('items');
        await context.sync();
        const h = sections.items[0]!.getHeader('Primary'),
          f = sections.items[0]!.getFooter('Primary');
        h.load('text');
        f.load('text');
        await context.sync();
        h.revisions.load('items');
        f.revisions.load('items');
        await context.sync();
        return {
          header: h.text,
          footer: f.text,
          revisions: h.revisions.items.length + f.revisions.items.length,
        };
      });
    } finally {
      runtime.dispose();
    }
  }
  try {
    const ah = (await read(a))[0]!,
      bf = (await read(b, footer))[0]!;
    // Collaboration assigns shared IDs during import; retain that targeting path.
    expect(ah.id.length).toBeGreaterThan(0);
    expect(bf.id.length).toBeGreaterThan(0);
    peers.pause();
    await Promise.all([
      replace(a, header, ah.id, 'Draft', 'Approved'),
      replace(b, footer, bf.id, '2026', '2027'),
    ]);
    peers.resume();
    flush();
    const state = await saved(a);
    expect(state.header).toContain('Approved');
    expect(state.footer).toContain('2027');
    expect(state.revisions).toBeGreaterThan(0);
    expect(await saved(b)).toEqual(state);

    expect(b.editor.exec({ type: 'undo' }).ok).toBe(true);
    flush();
    expect((await saved(a)).footer).not.toContain('2027');
    expect(await saved(a)).toEqual(await saved(b));
    expect(b.editor.exec({ type: 'redo' }).ok).toBe(true);
    flush();
    expect(await saved(a)).toEqual(state);
    expect(await saved(b)).toEqual(state);

    const stale = (await read(a))[1]!,
      deleting = (await read(b))[1]!;
    const deletion = await runWriterTool(
      b.runtime,
      b.editor,
      'edit_text',
      { story: header, edits: [{ action: 'deleteParagraph', paragraphId: deleting.id }] },
      'direct'
    );
    expect(deletion.success, deletion.output).toBe(true);
    flush();
    const refused = await runWriterTool(
      a.runtime,
      a.editor,
      'format_document',
      {
        story: header,
        targets: [{ paragraphId: stale.id }],
        changes: [{ property: 'bold', value: true }],
      },
      'direct'
    );
    expect(refused.success).toBe(false);
    expect(refused.code).toBe('StaleDocument');

    peers.pause();
    const remaining = (await read(a)).find((p) => p.text === 'Repeated')!;
    await replace(a, header, remaining.id, 'Repeated', 'Reconnected', 'direct');
    peers.resume();
    flush();
    expect((await saved(a)).header).toContain('Reconnected');
    expect(await saved(b)).toEqual(await saved(a));
  } finally {
    for (const peer of mounted) {
      peer.runtime.dispose();
      peer.editor.destroy();
      peer.container.remove();
    }
    harness.cleanup();
  }
});

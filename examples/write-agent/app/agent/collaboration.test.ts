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

test('writer edits synchronize, reject stale targets, and survive undo, redo, and reconnect', async () => {
  const harness = createPeerHarness('writer-api', { offlineEditing: true });
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
  const [a, b] = mounted;
  async function read(peer: typeof a) {
    const result = await runWriterTool(peer!.runtime, peer!.editor, 'read_document', {});
    expect(result.success, result.output).toBe(true);
    return JSON.parse(result.output).items;
  }
  function sync() {
    for (const peer of mounted) peer.room.session.flushPendingJournals();
  }
  async function text(peer: typeof a) {
    return peer!.runtime.run(async (context) => {
      context.document.body.load('text');
      await context.sync();
      return context.document.body.text;
    });
  }
  try {
    const first = (await read(a))[0];
    const run = a!.runtime.run.bind(a!.runtime);
    let injected = false;
    a!.runtime.run = (async (
      callback: (context: import('@docx-editor.dev/editor-api').RequestContext) => Promise<unknown>
    ) =>
      run(async (context) => {
        const originalSync = context.sync.bind(context);
        let reads = 0;
        context.sync = async () => {
          await originalSync();
          if (++reads === 2 && !injected) {
            injected = true;
            await b!.runtime.run(async (other) => {
              other.document.body.paragraphs.getFirst().insertText('Remote edit: ', 'Start');
              await other.sync();
            });
            sync();
          }
        };
        return callback(context);
      })) as typeof a.runtime.run;
    const raced = await runWriterTool(a!.runtime, a!.editor, 'edit_text', {
      edits: [
        {
          action: 'insertText',
          target: { paragraphId: first.id },
          location: 'Replace',
          text: 'Agent replacement',
        },
      ],
    });
    a!.runtime.run = run;
    expect(injected).toBe(true);
    expect(raced).toMatchObject({ success: false, code: 'StaleDocument', completedSteps: [] });
    expect(await text(a)).toContain('Remote edit: ');
    expect(await text(a)).not.toContain('Agent replacement');
    expect(await text(a)).toBe(await text(b));
    expect(b!.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync();
    const rows = await read(a);
    await read(b);
    const targetA = { paragraphId: rows[1].id, search: 'Example Client' };
    const targetB = { paragraphId: rows[3].id, search: 'Project goals' };
    peers.pause();
    const results = await Promise.all([
      runWriterTool(
        a!.runtime,
        a!.editor,
        'format_document',
        { targets: [targetA], changes: [{ property: 'bold', value: true }] },
        'suggest'
      ),
      runWriterTool(
        b!.runtime,
        b!.editor,
        'edit_text',
        {
          edits: [
            {
              action: 'insertText',
              target: targetB,
              text: 'Project objectives',
              location: 'Replace',
            },
          ],
        },
        'suggest'
      ),
    ]);
    for (const result of results) expect(result.success, result.output).toBe(true);
    peers.resume();
    sync();
    expect(await text(a)).toBe(await text(b));
    for (const peer of mounted) {
      const reopened = await DocxEditor.createServer(new Uint8Array(await peer.editor.save()));
      try {
        await reopened.run(async (context) => {
          const matches = context.document.body.search('Example Client');
          matches.load('items');
          context.document.revisions.load('items');
          await context.sync();
          matches.items[0]!.font.load('bold');
          await context.sync();
          expect(matches.items[0]!.font.bold).toBe(true);
          expect(context.document.revisions.items).toHaveLength(3);
        });
      } finally {
        reopened.dispose();
      }
    }
    expect(b!.editor.exec({ type: 'undo' }).ok).toBe(true);
    sync();
    expect(await text(a)).toBe(await text(b));
    expect(b!.editor.exec({ type: 'redo' }).ok).toBe(true);
    sync();
    expect(await text(a)).toBe(await text(b));
    await read(a);
    await read(b);
    const deletion = await runWriterTool(
      b!.runtime,
      b!.editor,
      'edit_text',
      { edits: [{ action: 'deleteParagraph', paragraphId: rows[1].id }] },
      'direct'
    );
    expect(deletion.success, deletion.output).toBe(true);
    sync();
    const stale = await runWriterTool(
      a!.runtime,
      a!.editor,
      'format_document',
      { targets: [targetA], changes: [{ property: 'italic', value: true }] },
      'direct'
    );
    expect(stale.success).toBe(false);
    expect(stale.code).toBe('StaleDocument');
    peers.pause();
    await read(a);
    await runWriterTool(
      a!.runtime,
      a!.editor,
      'edit_text',
      {
        edits: [
          {
            action: 'insertText',
            target: { paragraphId: rows[0].id, search: 'Draft project proposal' },
            text: 'Reconnected proposal',
            location: 'Replace',
          },
        ],
      },
      'direct'
    );
    peers.resume();
    sync();
    expect(await text(a)).toBe(await text(b));
    expect(await text(b)).toContain('Reconnected proposal');
    const draft = await runWriterTool(
      a!.runtime,
      a!.editor,
      'create_document',
      {
        brief: {
          documentType: 'Form',
          partiesOrAudience: 'Team',
          purpose: 'Plan',
          jurisdictionOrDomainRules: 'Internal',
          tone: 'Neutral',
          length: 'One page',
        },
        title: 'Team form',
        blocks: [
          { text: 'Team form', style: 'Title' },
          { text: '[First] and [Second]', style: 'Normal' },
        ],
      },
      'direct'
    );
    expect(draft.success, draft.output).toBe(true);
    sync();
    const formRows = await read(a);
    const field = formRows.find((row: { text: string }) => row.text === '[First] and [Second]');
    const controls = await runWriterTool(
      a!.runtime,
      a!.editor,
      'insert_content_controls',
      {
        fields: ['First', 'Second'].map((name) => ({
          paragraphId: field.id,
          search: `[${name}]`,
          tag: name,
          title: name,
          type: name === 'First' ? 'DatePicker' : 'PlainText',
        })),
      },
      'direct'
    );
    expect(controls.success, controls.output).toBe(true);
    sync();
    expect(await text(a)).toBe(await text(b));
    for (const peer of mounted) {
      const reopened = await DocxEditor.createServer(new Uint8Array(await peer.editor.save()));
      try {
        await reopened.run(async (context) => {
          context.document.body.contentControls.load('items');
          context.document.body.lists.load('items');
          await context.sync();
          expect(context.document.body.contentControls.items).toHaveLength(2);
          expect(context.document.body.lists.items).toHaveLength(0);
        });
      } finally {
        reopened.dispose();
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

/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `Body.insertFileFromBase64(base64File, 'Replace')` in a real collaboration room: a browser
// runtime's replacement and a server agent's replacement both reach the other participants as
// ordinary edits, converge with a concurrent peer edit, undo in one step, and survive a save
// and reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { DocxEditor as ServerDocxEditor } from '@docx-editor.dev/editor-api';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness } from './document-peer-support';
import {
  BASE,
  EDITED,
  SUGGESTED,
  updateFixture,
} from '../../../../core/src/store/__tests__/package-update-fixture.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
type Editor = ReturnType<typeof createDocxEditor>;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const base64Of = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

function mount(document: Uint8Array, collaboration: Parameters<typeof collaborationModule>[0]) {
  const container = globalThis.document.createElement('div');
  globalThis.document.body.append(container);
  const editor = createDocxEditor({
    container,
    document,
    author: 'Writer',
    modules: [reviewModule(), collaborationModule(collaboration)],
  });
  const runtime = DocxEditor.createBrowser(editor);
  cleanups.push(() => {
    runtime.dispose();
    editor.destroy();
    container.remove();
  });
  return { editor, runtime };
}

async function room() {
  const harness = createPeerHarness('insert-file-from-base64', { offlineEditing: true });
  cleanups.push(() => harness.cleanup());
  const pair = await harness.pair(updateFixture(BASE));
  pair.alice.detach();
  pair.bob.detach();
  const alice = mount(pair.alice.room.document, { session: pair.alice.room.session });
  const bob = mount(pair.bob.room.document, { session: pair.bob.room.session });
  const sync = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
  };
  return { harness, pair, alice, bob, sync };
}

async function savedXml(editor: Editor): Promise<Record<string, string>> {
  const files = unzipSync(new Uint8Array(await editor.save()));
  return Object.fromEntries(
    Object.entries(files)
      .filter(([name]) => name.endsWith('.xml') || name.endsWith('.rels'))
      .map(([name, bytes]) => {
        const xml = strFromU8(bytes);
        // Content types compare as a set: replicas may record overrides in another order.
        if (name === '[Content_Types].xml')
          return [name, (xml.match(/<(Default|Override) [^>]*\/>/g) ?? []).sort().join('\n')];
        return [name, xml];
      })
  );
}

const text = (editor: Editor) => editor.surface!.session.bodyText();

test('a browser replacement reaches the peer; undo and redo move both in one step', async () => {
  const r = await room();
  const before = await savedXml(r.alice.editor);
  await r.alice.runtime.run(async (context) => {
    context.document.body.insertFileFromBase64(base64Of(updateFixture(SUGGESTED)), 'Replace');
    await context.sync();
  });
  r.sync();
  const after = await savedXml(r.alice.editor);
  expect(after).not.toEqual(before);
  expect(await savedXml(r.bob.editor)).toEqual(after);
  expect(r.alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  r.sync();
  expect(await savedXml(r.alice.editor)).toEqual(before);
  expect(await savedXml(r.bob.editor)).toEqual(before);
  expect(r.alice.editor.exec({ type: 'redo' }).ok).toBe(true);
  r.sync();
  expect(await savedXml(r.bob.editor)).toEqual(after);

  // Save and reopen keeps the replacement.
  const reopened = await ServerDocxEditor.createServer(new Uint8Array(await r.bob.editor.save()));
  try {
    const reopenedText = await reopened.run(async (context) => {
      const body = context.document.body;
      body.load('text');
      await context.sync();
      return body.text;
    });
    expect(reopenedText.replace(/\r/g, '')).toBe(text(r.bob.editor).replace(/\n/g, ''));
  } finally {
    reopened.dispose();
  }
});

test('a concurrent peer edit converges with a browser replacement', async () => {
  const r = await room();
  r.pair.pause();
  await r.alice.runtime.run(async (context) => {
    context.document.body.insertFileFromBase64(base64Of(updateFixture(EDITED)), 'Replace');
    await context.sync();
  });
  await r.bob.runtime.run(async (context) => {
    context.document.body.paragraphs.getLast().insertText('Peer ', 'Start');
    await context.sync();
  });
  r.sync();
  r.pair.resume();
  r.sync();
  expect(text(r.alice.editor)).toBe(text(r.bob.editor));
  expect(text(r.alice.editor)).toContain('Goal of this agreement.');
  expect(text(r.alice.editor)).toContain('Peer ');
  expect(r.alice.editor.exec({ type: 'undo' }).ok).toBe(true);
  r.sync();
  expect(text(r.alice.editor)).toBe(text(r.bob.editor));
  expect(text(r.alice.editor)).toContain('Purpose of this agreement.');
  expect(text(r.alice.editor)).toContain('Peer ');
});

test('a server agent replacement is a shared edit the browser peers receive', async () => {
  const r = await room();
  const agentPeer = await r.harness.join(r.pair.alice, 'Agent');
  agentPeer.detach();
  const agent = await ServerDocxEditor.createCollaborative(
    agentPeer.room.document,
    agentPeer.room.session
  );
  cleanups.push(() => agent.dispose());
  const text0 = await agent.run(async (context) => {
    const range = context.document.body.insertFileFromBase64(
      base64Of(updateFixture(EDITED)),
      'Replace'
    );
    range.load('text');
    await context.sync();
    return range.text;
  });
  expect(text0).toContain('Goal of this agreement.');
  agentPeer.room.session.flushPendingJournals();
  r.sync();
  expect(text(r.alice.editor)).toContain('Goal of this agreement.');
  expect(text(r.bob.editor)).toBe(text(r.alice.editor));
  expect(await savedXml(r.bob.editor)).toEqual(await savedXml(r.alice.editor));
});

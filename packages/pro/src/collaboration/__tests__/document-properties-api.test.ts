/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { collaborationModule } from '../../index';
import { createPeerHarness, zipDocument } from './document-peer-support';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

test('document properties synchronize between real editor sessions', async () => {
  const harness = createPeerHarness('document-properties', { offlineEditing: true });
  const seed = await DocxEditor.createServer(zipDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p>'));
  await seed.run(async (c) => {
    c.document.properties.author = 'Author';
    c.document.properties.title = 'Title';
    await c.sync();
  });
  const pair = await harness.pair(await seed.save());
  seed.dispose();
  const peers = [pair.alice, pair.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    return { editor, container, runtime: DocxEditor.createBrowser(editor) };
  });
  const read = async (index: number) =>
    peers[index]!.runtime.run(async (c) => {
      c.document.properties.load('author,title');
      await c.sync();
      return [c.document.properties.author, c.document.properties.title];
    });
  try {
    await peers[0]!.runtime.run(async (c) => {
      c.document.properties.author = 'Author';
      await c.sync();
    });
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
    expect(await read(1)).toEqual(['Author', 'Title']);
    pair.pause();
    // Removal refuses before any package edit, including while another peer writes.
    const beforeRemoval = new Uint8Array(await peers[0]!.editor.save());
    await expect(
      peers[0]!.runtime.run(async (c) => {
        c.document.removeDocumentInformation('DocumentProperties');
        await c.sync();
      })
    ).rejects.toMatchObject({ code: 'NotSupported' });
    expect(new Uint8Array(await peers[0]!.editor.save())).toEqual(beforeRemoval);
    await peers[0]!.runtime.run(async (c) => {
      c.document.properties.author = 'Alice';
      await c.sync();
    });
    await peers[1]!.runtime.run(async (c) => {
      c.document.properties.title = 'Bob';
      await c.sync();
    });
    await expect(
      peers[1]!.runtime.run(async (c) => {
        c.document.removeDocumentInformation('DocumentProperties');
        await c.sync();
      })
    ).rejects.toMatchObject({ code: 'NotSupported' });
    pair.resume();
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
    expect(await read(0)).toEqual(['Alice', 'Bob']);
    expect(await read(1)).toEqual(['Alice', 'Bob']);
    expect(peers[0]!.editor.exec({ type: 'undo' }).ok).toBe(true);
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
    expect(await read(1)).toEqual(['Author', 'Bob']);
    expect(peers[0]!.editor.exec({ type: 'redo' }).ok).toBe(true);
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
    expect(await read(1)).toEqual(['Alice', 'Bob']);
    const savedParts = [];
    for (const peer of peers)
      savedParts.push(
        strFromU8(unzipSync(new Uint8Array(await peer.editor.save()))['docProps/core.xml']!)
      );
    expect(savedParts[0]).toBe(savedParts[1]);
    const joined = await harness.join(pair.alice, 'rejoined');
    const joinedContainer = document.createElement('div');
    document.body.appendChild(joinedContainer);
    joined.detach();
    const joinedEditor = createDocxEditor({
      container: joinedContainer,
      document: joined.room.document,
      modules: [collaborationModule({ session: joined.room.session })],
    });
    const joinedRuntime = DocxEditor.createBrowser(joinedEditor);
    await joinedRuntime.run(async (c) => {
      c.document.properties.load('author,title');
      await c.sync();
      expect([c.document.properties.author, c.document.properties.title]).toEqual(['Alice', 'Bob']);
    });
    joinedRuntime.dispose();
    joinedEditor.destroy();
    joinedContainer.remove();
    harness.leave(joined);
    const reopened = await DocxEditor.createServer(new Uint8Array(await peers[1]!.editor.save()));
    await reopened.run(async (c) => {
      c.document.properties.load('author,title');
      await c.sync();
      expect(c.document.properties.author).toBe('Alice');
      expect(c.document.properties.title).toBe('Bob');
    });
    reopened.dispose();
    pair.pause();
    await peers[0]!.runtime.run(async (c) => {
      c.document.properties.author = '';
      await c.sync();
    });
    await peers[1]!.runtime.run(async (c) => {
      c.document.properties.title = 'Next';
      await c.sync();
    });
    pair.resume();
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
    expect(await read(0)).toEqual(['', 'Next']);
    expect(await read(1)).toEqual(['', 'Next']);
  } finally {
    for (const peer of peers) {
      peer.runtime.dispose();
      peer.editor.destroy();
      peer.container.remove();
    }
    harness.cleanup();
  }
});

test('collaboration refuses initial core-property part creation on both editors', async () => {
  const harness = createPeerHarness('document-properties-absent', { offlineEditing: true });
  const pair = await harness.pair(zipDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p>'));
  const peers = [pair.alice, pair.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    return { editor, container, runtime: DocxEditor.createBrowser(editor) };
  });
  try {
    pair.pause();
    for (const peer of peers) {
      await expect(
        peer.runtime.run(async (c) => {
          c.document.properties.author = 'Refused';
          await c.sync();
        })
      ).rejects.toMatchObject({ code: 'NotSupported' });
    }
    pair.resume();
    for (const peer of peers) {
      await peer.runtime.run(async (c) => {
        c.document.properties.load('author,title');
        c.document.body.load('text');
        await c.sync();
        expect(c.document.properties.author).toBe('');
        expect(c.document.properties.title).toBe('');
        expect(c.document.body.text).toBe('Body');
      });
      expect(
        unzipSync(new Uint8Array(await peer.editor.save()))['docProps/core.xml']
      ).toBeUndefined();
    }
  } finally {
    for (const peer of peers) {
      peer.runtime.dispose();
      peer.editor.destroy();
      peer.container.remove();
    }
    harness.cleanup();
  }
});

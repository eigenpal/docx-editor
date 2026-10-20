/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A field proposed as a tracked insertion through the editing API, across two live peers.
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import {
  DocxEditor,
  type DocxEditorRuntime,
  type RequestContext,
} from '@docx-editor.dev/editor-api/browser';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, zipDocument } from './document-peer-support';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

const SAMPLE = () =>
  zipDocument(
    '<w:p><w:r><w:t xml:space="preserve">See figure here.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p>'
  );

async function room() {
  const harness = createPeerHarness('tracked-field', { offlineEditing: true });
  const pair = await harness.pair(SAMPLE());
  const peers = [pair.alice, pair.bob].map((peer, index) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    const author = index === 0 ? 'Field agent' : 'Reviewer';
    return { ...peer, editor, runtime: DocxEditor.createBrowser(editor, { author }), container };
  });
  return {
    pair,
    harness,
    peers,
    sync() {
      for (const peer of peers) peer.room.session.flushPendingJournals();
    },
    close() {
      for (const peer of peers) {
        peer.runtime.dispose();
        peer.editor.destroy();
        peer.container.remove();
      }
      harness.cleanup();
    },
  };
}

async function fieldCodes(c: RequestContext): Promise<string[]> {
  c.document.body.fields.load('items');
  await c.sync();
  for (const field of c.document.body.fields.items) field.load('code');
  await c.sync();
  return c.document.body.fields.items.map((field) => field.code.trim());
}

async function proposeField(runtime: DocxEditorRuntime): Promise<void> {
  await runtime.run(async (c) => {
    c.document.changeTrackingMode = 'TrackMineOnly';
    c.document.body.search('figure').getFirst().insertField('After', 'Ref', '_Ref1 \\h');
    await c.sync();
  });
}

test('a tracked field converges with concurrent edits, survives reopen and reconnect, and rejects on the other peer', async () => {
  const r = await room();
  try {
    r.pair.pause();
    await proposeField(r.peers[0]!.runtime);
    // Concurrent: the other peer types beside the field and edits the next paragraph.
    await r.peers[1]!.runtime.run(async (c) => {
      c.document.body.search('here').getFirst().insertText('right ', 'Before');
      c.document.body.paragraphs.getLast().insertText(' Edited.', 'End');
      await c.sync();
    });
    r.sync();
    r.pair.resume();
    r.sync();
    const texts = r.peers.map((peer) => peer.editor.surface!.session.bodyText());
    expect(texts[0]).toBe(texts[1]);
    for (const peer of r.peers) {
      await peer.runtime.run(async (c) => {
        expect(await fieldCodes(c)).toEqual(['REF _Ref1 \\h']);
      });
      const bytes = new Uint8Array(await peer.editor.save());
      const xml = strFromU8(unzipSync(bytes)['word/document.xml']!);
      expect(xml).toMatch(
        /<w:ins [^>]*w:author="Field agent"[^>]*><w:r><w:fldChar w:dirty="true" w:fldCharType="begin"\/>/
      );
      expect(xml).not.toContain('fldSimple');
      const reopened = await DocxEditor.createServer(bytes);
      try {
        await reopened.run(async (c) => {
          expect(await fieldCodes(c)).toEqual(['REF _Ref1 \\h']);
          c.document.body.load('text');
          await c.sync();
          expect(c.document.body.text).toBe('See figure right here.\rSecond paragraph. Edited.');
        });
      } finally {
        reopened.dispose();
      }
    }
    // A peer that reconnects reads the pending field.
    const rejoined = await r.harness.join(r.pair.alice, 'field-rejoined');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const joined = createDocxEditor({
      container,
      document: rejoined.room.document,
      modules: [reviewModule(), collaborationModule({ session: rejoined.room.session })],
    });
    const joinedRuntime = DocxEditor.createBrowser(joined);
    try {
      await joinedRuntime.run(async (c) => {
        expect(await fieldCodes(c)).toEqual(['REF _Ref1 \\h']);
        c.document.body.revisions.load('items');
        await c.sync();
        expect(c.document.body.revisions.items.length).toBeGreaterThan(0);
      });
    } finally {
      joinedRuntime.dispose();
      joined.destroy();
      container.remove();
      r.harness.leave(rejoined);
    }
    // The other peer rejects: the whole field leaves both replicas.
    await r.peers[1]!.runtime.run(async (c) => {
      c.document.body.revisions.rejectAll();
      await c.sync();
    });
    r.sync();
    for (const peer of r.peers) {
      await peer.runtime.run(async (c) => {
        expect(await fieldCodes(c)).toEqual([]);
      });
      const xml = strFromU8(
        unzipSync(new Uint8Array(await peer.editor.save()))['word/document.xml']!
      );
      expect(xml).not.toContain('fldChar');
      expect(xml).not.toMatch(/<w:ins[ >]/);
    }
  } finally {
    r.close();
  }
});

test('accept on the other peer keeps the field on both replicas', async () => {
  const r = await room();
  try {
    await proposeField(r.peers[0]!.runtime);
    r.sync();
    await r.peers[1]!.runtime.run(async (c) => {
      c.document.body.revisions.acceptAll();
      await c.sync();
    });
    r.sync();
    for (const peer of r.peers) {
      await peer.runtime.run(async (c) => {
        expect(await fieldCodes(c)).toEqual(['REF _Ref1 \\h']);
      });
      const xml = strFromU8(
        unzipSync(new Uint8Array(await peer.editor.save()))['word/document.xml']!
      );
      expect(xml).toContain('w:fldCharType="begin"');
      expect(xml).not.toMatch(/<w:ins[ >]/);
    }
  } finally {
    r.close();
  }
});

test('deleting the text around a pending field on the other peer keeps both replicas equal', async () => {
  const r = await room();
  try {
    r.pair.pause();
    await proposeField(r.peers[0]!.runtime);
    await r.peers[1]!.runtime.run(async (c) => {
      c.document.body.search('figure').getFirst().delete();
      await c.sync();
    });
    r.sync();
    r.pair.resume();
    r.sync();
    const texts = r.peers.map((peer) => peer.editor.surface!.session.bodyText());
    expect(texts[0]).toBe(texts[1]);
    const codes = await Promise.all(r.peers.map((peer) => peer.runtime.run(fieldCodes)));
    expect(codes[0]).toEqual(codes[1]);
    expect(codes[0]).toEqual(['REF _Ref1 \\h']);
  } finally {
    r.close();
  }
});

test('undo and redo of a tracked field replicate', async () => {
  const r = await room();
  try {
    await proposeField(r.peers[0]!.runtime);
    r.sync();
    expect(r.peers[0]!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    for (const peer of r.peers)
      await peer.runtime.run(async (c) => {
        expect(await fieldCodes(c)).toEqual([]);
      });
    expect(r.peers[0]!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    for (const peer of r.peers)
      await peer.runtime.run(async (c) => {
        expect(await fieldCodes(c)).toEqual(['REF _Ref1 \\h']);
        c.document.body.revisions.load('items');
        await c.sync();
        expect(c.document.body.revisions.items).toHaveLength(1);
      });
  } finally {
    r.close();
  }
});

test('a field result written on one peer converges, tracked inside its own insertion', async () => {
  const r = await room();
  try {
    await r.peers[0]!.runtime.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      const field = c.document.body.search('figure').getFirst().insertField('After', 'Seq', 'Eq');
      await c.sync();
      field.result.insertText('(1)', 'Replace');
      await c.sync();
    });
    r.sync();
    for (const peer of r.peers) {
      await peer.runtime.run(async (c) => {
        const fields = c.document.body.fields;
        fields.load('items');
        await c.sync();
        expect(fields.items).toHaveLength(1);
        fields.items[0]!.load('result');
        await c.sync();
        expect(fields.items[0]!.result.text).toBe('(1)');
        c.document.body.load('text');
        await c.sync();
        expect(c.document.body.text).toBe('See figure(1) here.\rSecond paragraph.');
      });
      const xml = strFromU8(
        unzipSync(new Uint8Array(await peer.editor.save()))['word/document.xml']!
      );
      expect(xml).toMatch(
        /<w:ins [^>]*>(?:(?!<\/w:ins>).)*<w:t>\(1\)<\/w:t>(?:(?!<\/w:ins>).)*<\/w:ins>/
      );
      expect(xml).toContain('w:dirty="true"');
    }
    // The other peer rejects: the field leaves with its result.
    await r.peers[1]!.runtime.run(async (c) => {
      c.document.body.revisions.rejectAll();
      await c.sync();
    });
    r.sync();
    for (const peer of r.peers)
      await peer.runtime.run(async (c) => {
        expect(await fieldCodes(c)).toEqual([]);
        c.document.body.load('text');
        await c.sync();
        expect(c.document.body.text).toBe('See figure here.\rSecond paragraph.');
      });
  } finally {
    r.close();
  }
});

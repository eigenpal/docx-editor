/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A range delete through the document API removes a whole `IF` field whose field codes span
// paragraphs (ECMA-376 Part 1, 17.16.18, CT_FldChar; 17.16.23, instrText), on two
// collaborating editors. The delete is existing paragraph ops: it removes the paragraphs inside
// the field codes and joins the rest. Each test makes the peers diverge or undo, then checks
// that they converge on the same text, save the same bytes, and reopen the same way.

import { afterAll, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, zipDocument } from './document-peer-support';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const FIELD =
  p('Top') +
  '<w:p><w:r><w:t xml:space="preserve">Alpha </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve">IF 1 = 1 "</w:instrText></w:r></w:p>' +
  '<w:p><w:r><w:instrText>Inside</w:instrText></w:r></w:p>' +
  '<w:p><w:r><w:instrText xml:space="preserve">" ""</w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Yes</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>' +
  p('Bottom');
const ORIGINAL = ['Top', 'Alpha ', '', 'Yes tail', 'Bottom'];
const REMOVED = ['Top', 'Alpha  tail', 'Bottom'];

async function room() {
  const harness = createPeerHarness('field-code-range-delete', { offlineEditing: true });
  const pair = await harness.pair(zipDocument(FIELD));
  const peers = [
    { peer: pair.alice, author: 'Alice' },
    { peer: pair.bob, author: 'Bob' },
  ].map(({ peer, author }) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    return { ...peer, editor, runtime: DocxEditor.createBrowser(editor, { author }), container };
  });
  return {
    pair,
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
type Room = Awaited<ReturnType<typeof room>>;
type Runtime = ReturnType<typeof DocxEditor.createBrowser>;

async function texts(runtime: Runtime): Promise<string[]> {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    return paragraphs.items.map((paragraph) => paragraph.text);
  });
}

/** Delete from after "Alpha " through the field result "Yes". */
async function removeField(runtime: Runtime): Promise<void> {
  await runtime.run(async (context) => {
    const head = context.document.body.search('Alpha ');
    const tail = context.document.body.search('Yes');
    head.load('items');
    tail.load('items');
    await context.sync();
    head.items[0]!.getRange('End').expandTo(tail.items[0]!.getRange('End')).delete();
    await context.sync();
  });
}

/** Both peers agree on text and saved bytes, and a reopened save reads the same. */
async function expectConverged(r: Room, expected?: readonly string[]): Promise<string> {
  r.sync();
  for (const peer of r.peers) expect(peer.room.session.statusSnapshot().status).toBe('ready');
  const [left, right] = await Promise.all(r.peers.map((peer) => texts(peer.runtime)));
  expect(left).toEqual(right!);
  if (expected) expect(left).toEqual([...expected]);
  const saved = await Promise.all(
    r.peers.map(async (peer) => new Uint8Array(await peer.editor.save()))
  );
  const xml = saved.map((bytes) => strFromU8(unzipSync(bytes)['word/document.xml']!));
  expect(xml[0]).toBe(xml[1]!);
  const reopened = await DocxEditor.createServer(saved[0]!);
  try {
    expect(await texts(reopened)).toEqual(left!);
  } finally {
    reopened.dispose();
  }
  return xml[0]!;
}

test('a range delete over the whole field replicates, undoes, and redoes', async () => {
  const r = await room();
  try {
    const [alice] = r.peers;
    await removeField(alice!.runtime);
    let xml = await expectConverged(r, REMOVED);
    expect(xml).not.toContain('fldChar');
    expect(xml).not.toContain('instrText');

    expect(alice!.editor.exec({ type: 'undo' }).ok).toBe(true);
    xml = await expectConverged(r, ORIGINAL);
    expect(xml.match(/<w:fldChar /g)).toHaveLength(3);
    expect(xml).toContain('Inside');

    expect(alice!.editor.exec({ type: 'redo' }).ok).toBe(true);
    xml = await expectConverged(r, REMOVED);
    expect(xml).not.toContain('fldChar');
  } finally {
    r.close();
  }
});

test('typing after the field while the other peer removes it keeps the typed text', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    r.pair.pause();
    await removeField(alice!.runtime);
    await bob!.runtime.run(async (context) => {
      context.document.body.paragraphs.load('items');
      await context.sync();
      context.document.body.paragraphs.items[3]!.insertText('!', 'End');
      await context.sync();
    });
    r.pair.resume();
    const xml = await expectConverged(r, ['Top', 'Alpha  tail!', 'Bottom']);
    expect(xml).not.toContain('fldChar');
  } finally {
    r.close();
  }
});

test('editing inside the removed field while the other peer removes it converges', async () => {
  const r = await room();
  try {
    const [alice, bob] = r.peers;
    r.pair.pause();
    await removeField(alice!.runtime);
    // Bob writes into the field result and into a paragraph inside the field codes.
    await bob!.runtime.run(async (context) => {
      const result = context.document.body.search('Yes');
      const paragraphs = context.document.body.paragraphs;
      result.load('items');
      paragraphs.load('items');
      await context.sync();
      result.items[0]!.insertText('Yes!', 'Replace');
      paragraphs.items[2]!.insertText('code', 'End');
      await context.sync();
    });
    r.pair.resume();
    // The removal wins over edits inside the removed range, and no field character survives
    // without the rest of its field.
    const xml = await expectConverged(r, REMOVED);
    expect(xml).not.toContain('fldChar');
  } finally {
    r.close();
  }
});

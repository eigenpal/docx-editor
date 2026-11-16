/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The `replaceDocument` command in a real collaboration room, with no refresh controller: the
// replacement reaches the other participant as an ordinary edit, converges with concurrent
// edits, and the author's undo takes back the replacement alone.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness } from './document-peer-support';
import {
  BASE,
  EDITED,
  SUGGESTED,
  para,
  run,
  updateFixture,
} from '../../../../core/src/store/__tests__/package-update-fixture.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
type Editor = ReturnType<typeof createDocxEditor>;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function mount(document: Uint8Array, collaboration?: Parameters<typeof collaborationModule>[0]) {
  const container = globalThis.document.createElement('div');
  globalThis.document.body.append(container);
  const editor = createDocxEditor({
    container,
    document,
    author: 'Writer',
    modules: [reviewModule(), ...(collaboration ? [collaborationModule(collaboration)] : [])],
  });
  cleanups.push(() => {
    editor.destroy();
    container.remove();
  });
  return editor;
}

async function room() {
  const harness = createPeerHarness('replace-document', { offlineEditing: true });
  const pair = await harness.pair(updateFixture(BASE));
  pair.alice.detach();
  pair.bob.detach();
  const alice = mount(pair.alice.room.document, { session: pair.alice.room.session });
  const bob = mount(pair.bob.room.document, { session: pair.bob.room.session });
  cleanups.push(() => harness.cleanup());
  const sync = () => {
    pair.alice.room.session.flushPendingJournals();
    pair.bob.room.session.flushPendingJournals();
  };
  return { alice, bob, pair, sync };
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

test('a replacement reaches the peer, and undo and redo move both in one step', async () => {
  const r = await room();
  const before = await savedXml(r.alice);
  const result = r.alice.exec({ type: 'replaceDocument', docx: updateFixture(SUGGESTED) });
  expect(result).toMatchObject({ ok: true, changed: true });
  r.sync();
  const after = await savedXml(r.alice);
  expect(await savedXml(r.bob)).toEqual(after);
  expect(r.alice.exec({ type: 'undo' }).ok).toBe(true);
  r.sync();
  expect(await savedXml(r.alice)).toEqual(before);
  expect(await savedXml(r.bob)).toEqual(before);
  expect(r.alice.exec({ type: 'redo' }).ok).toBe(true);
  r.sync();
  expect(await savedXml(r.bob)).toEqual(after);
});

test("a concurrent peer edit converges, and undo keeps the peer's edit", async () => {
  const r = await room();
  r.pair.pause();
  expect(r.alice.exec({ type: 'replaceDocument', docx: updateFixture(EDITED) }).ok).toBe(true);
  const paragraphs = r.bob.surface!.session.paragraphIds();
  const last = paragraphs[paragraphs.length - 1]!;
  r.bob.surface!.setSelection({
    anchor: { paragraphId: last, offset: 0 },
    head: { paragraphId: last, offset: 0 },
  });
  r.bob.surface!.type('Peer ');
  r.sync();
  r.pair.resume();
  r.sync();
  expect(text(r.alice)).toBe(text(r.bob));
  expect(text(r.alice)).toContain('Goal of this agreement.');
  expect(text(r.alice)).toContain('Peer Closing paragraph.');
  expect(r.alice.exec({ type: 'undo' }).ok).toBe(true);
  r.sync();
  expect(text(r.alice)).toBe(text(r.bob));
  expect(text(r.alice)).toContain('Purpose of this agreement.');
  expect(text(r.alice)).toContain('Peer Closing paragraph.');
});

test("a peer's edit makes an expected handle stale, and nothing changes", async () => {
  const r = await room();
  const expected = r.alice.getDocumentHandle();
  const first = r.bob.surface!.session.paragraphIds()[0]!;
  r.bob.surface!.setSelection({
    anchor: { paragraphId: first, offset: 0 },
    head: { paragraphId: first, offset: 0 },
  });
  r.bob.surface!.type('Remote ');
  r.sync();
  const before = await savedXml(r.alice);
  const result = r.alice.exec({
    type: 'replaceDocument',
    docx: updateFixture(EDITED),
    expected,
  });
  expect(result).toMatchObject({
    ok: false,
    replaceDocument: { code: 'staleDocument', reason: 'edited' },
  });
  expect(await savedXml(r.alice)).toEqual(before);
  expect(r.alice.snapshot().canUndo).toBe(false);
});

test("the peer's own undo keeps the replacement, and both save and reopen the same", async () => {
  const r = await room();
  const first = r.bob.surface!.session.paragraphIds()[0]!;
  r.bob.surface!.setSelection({
    anchor: { paragraphId: first, offset: 0 },
    head: { paragraphId: first, offset: 0 },
  });
  r.bob.surface!.type('Bob ');
  r.sync();
  expect(r.alice.exec({ type: 'replaceDocument', docx: updateFixture(SUGGESTED) }).ok).toBe(true);
  r.sync();
  // Bob's undo takes back Bob's typing only; Alice's replacement stays.
  expect(r.bob.exec({ type: 'undo' }).ok).toBe(true);
  r.sync();
  expect(text(r.bob)).toBe(text(r.alice));
  expect(await savedXml(r.bob)).toEqual(await savedXml(r.alice));
  expect(text(r.alice)).toContain('New clause');
  for (const editor of [r.alice, r.bob]) {
    const reopened = mount(new Uint8Array(await editor.save()));
    expect(await savedXml(reopened)).toEqual(await savedXml(editor));
  }
});

test('a replacement the room refuses reports collaborationRefused and changes neither peer', async () => {
  const r = await room();
  const before = await savedXml(r.alice);
  const oversized = para(
    '00000005',
    `<w:ins w:id="40" w:author="${'A'.repeat(5000)}" w:date="2030-01-01T00:00:00Z">${run('Closing paragraph.')}</w:ins>`
  );
  const result = r.alice.exec({
    type: 'replaceDocument',
    docx: updateFixture({ ...BASE, paragraphs: [...BASE.paragraphs.slice(0, 4), oversized] }),
  });
  r.sync();
  expect(result).toMatchObject({
    ok: false,
    code: 'unsupported',
    replaceDocument: { code: 'editUnsupported', reason: 'collaborationRefused' },
  });
  expect(await savedXml(r.alice)).toEqual(before);
  expect(await savedXml(r.bob)).toEqual(before);
  expect(r.alice.snapshot().canUndo).toBe(false);
});

/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An external processor's result applied with `applyUpdate({ mode: 'edit' })` in a real
// collaboration room: it reaches the other participant as an ordinary edit, converges with
// concurrent edits, and the author's undo takes back the update alone.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, createDocumentRefresh } from '@docx-editor.dev/core/editor';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness } from './document-peer-support';
import {
  BASE,
  EDITED,
  para,
  run,
  SUGGESTED,
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

async function room(bytes = updateFixture(BASE)) {
  const harness = createPeerHarness('refresh-edit', { offlineEditing: true });
  const pair = await harness.pair(bytes);
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

/** The review queue as a reader sees it: comments and pending changes with their attribution. */
function review(editor: Editor) {
  return editor
    .getReviewItems()
    .map((item) =>
      item.kind === 'comment'
        ? `comment:${item.author}:${item.text}:${item.parentId ? 'reply' : 'thread'}:${item.resolved}`
        : `${item.kind}:${'author' in item ? item.author : ''}:${'text' in item ? item.text : ''}`
    )
    .sort();
}

async function applyEdit(editor: Editor, bytes: Uint8Array, sequence = 1) {
  const refresh = createDocumentRefresh(editor);
  const submission = await refresh.capture();
  return refresh.applyUpdate({ submission, sequence, bytes, mode: 'edit' });
}

test('reaches the other participant as an edit, with comments and pending changes as returned', async () => {
  const r = await room();
  const returned = updateFixture(SUGGESTED);
  expect(await applyEdit(r.alice, returned)).toMatchObject({ ok: true, mode: 'edit' });
  r.sync();
  expect(text(r.bob)).toBe(text(r.alice));
  expect(await savedXml(r.bob)).toEqual(await savedXml(r.alice));
  const expected = review(mount(returned));
  expect(review(r.alice)).toEqual(expected);
  expect(review(r.bob)).toEqual(expected);
  // No duplicated comments and no extra revisions.
  expect(expected.filter((item) => item.startsWith('comment:'))).toHaveLength(3);
  expect(expected.filter((item) => !item.startsWith('comment:'))).toHaveLength(3);
  for (const editor of [r.alice, r.bob]) {
    expect(review(mount(new Uint8Array(await editor.save())))).toEqual(expected);
  }
});

test("the author's undo and redo move both participants back and forth in one step", async () => {
  const r = await room();
  const before = await savedXml(r.alice);
  await applyEdit(r.alice, updateFixture(SUGGESTED));
  r.sync();
  const after = await savedXml(r.alice);
  expect(r.alice.exec({ type: 'undo' }).ok).toBe(true);
  r.sync();
  expect(await savedXml(r.alice)).toEqual(before);
  expect(await savedXml(r.bob)).toEqual(before);
  expect(r.alice.exec({ type: 'redo' }).ok).toBe(true);
  r.sync();
  expect(await savedXml(r.alice)).toEqual(after);
  expect(await savedXml(r.bob)).toEqual(after);
});

test("a concurrent edit converges, and undo takes back the update but not the peer's edit", async () => {
  const r = await room();
  r.pair.pause();
  await applyEdit(r.alice, updateFixture(EDITED));
  const bobParagraphs = r.bob.surface!.session.paragraphIds();
  const last = bobParagraphs[bobParagraphs.length - 1]!;
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
  expect(await savedXml(mount(new Uint8Array(await r.bob.save())))).toEqual(await savedXml(r.bob));
});

test('a paragraph a peer deletes while the update edits it converges on both sides', async () => {
  const r = await room();
  r.pair.pause();
  await applyEdit(r.alice, updateFixture(EDITED));
  const first = r.bob.surface!.session.paragraphIds()[0]!;
  const second = r.bob.surface!.session.paragraphIds()[1]!;
  r.bob.surface!.setSelection({
    anchor: { paragraphId: first, offset: 0 },
    head: { paragraphId: second, offset: 0 },
  });
  r.bob.surface!.deleteBackward();
  expect(text(r.bob)).not.toContain('Purpose');
  r.sync();
  r.pair.resume();
  r.sync();
  expect(text(r.alice)).toBe(text(r.bob));
  expect(await savedXml(r.alice)).toEqual(await savedXml(r.bob));
  const reopened = mount(new Uint8Array(await r.alice.save()));
  expect(text(reopened)).toBe(text(r.alice));
});

test('an update made offline reaches the peer after reconnecting', async () => {
  const r = await room();
  r.pair.pause();
  expect((await applyEdit(r.alice, updateFixture(SUGGESTED))).ok).toBe(true);
  r.sync();
  expect(text(r.bob)).not.toContain('New clause');
  r.pair.resume();
  r.sync();
  expect(await savedXml(r.bob)).toEqual(await savedXml(r.alice));
  expect(text(r.bob)).toContain('New clause with a suggestion.');
});

test("a peer's edit after capture refuses the update, and a reload refuses in collaboration", async () => {
  const r = await room();
  const refresh = createDocumentRefresh(r.alice);
  const submission = await refresh.capture();
  const paragraph = r.bob.surface!.session.paragraphIds()[0]!;
  r.bob.surface!.setSelection({
    anchor: { paragraphId: paragraph, offset: 0 },
    head: { paragraphId: paragraph, offset: 0 },
  });
  r.bob.surface!.type('Remote ');
  r.sync();
  const before = await savedXml(r.alice);
  expect(
    await refresh.applyUpdate({
      submission,
      sequence: 1,
      bytes: updateFixture(EDITED),
      mode: 'edit',
    })
  ).toMatchObject({ ok: false, code: 'local-edits' });
  expect(await savedXml(r.alice)).toEqual(before);
  const next = await refresh.capture();
  expect(
    await refresh.applyUpdate({ submission: next, sequence: 1, bytes: updateFixture(EDITED) })
  ).toMatchObject({ ok: false, code: 'collaboration' });
  expect(await savedXml(r.alice)).toEqual(before);
});

test('an update the room refuses reports edit-unsupported and changes neither participant', async () => {
  const r = await room();
  const before = await savedXml(r.alice);
  const refresh = createDocumentRefresh(r.alice);
  const submission = await refresh.capture();
  // The editor admits the journal; the room refuses an attribute past its string limit.
  const oversized = para(
    '00000005',
    `<w:ins w:id="40" w:author="${'A'.repeat(5000)}" w:date="2030-01-01T00:00:00Z">${run('Closing paragraph.')}</w:ins>`
  );
  const result = await refresh.applyUpdate({
    submission,
    sequence: 1,
    bytes: updateFixture({ ...BASE, paragraphs: [...BASE.paragraphs.slice(0, 4), oversized] }),
    mode: 'edit',
  });
  r.sync();
  expect(result).toMatchObject({
    ok: false,
    code: 'edit-unsupported',
    reason: 'collaboration-refused',
  });
  // `reason` narrows `code`; this file is type-checked, so a looser union fails the build.
  if (!result.ok && result.reason === 'collaboration-refused') {
    const code: 'edit-unsupported' = result.code;
    expect(code).toBe('edit-unsupported');
  }
  expect(await savedXml(r.alice)).toEqual(before);
  expect(await savedXml(r.bob)).toEqual(before);
  expect(r.alice.snapshot().canUndo).toBe(false);
  expect(r.pair.alice.room.session.status()).toBe('ready');
});

test('undoing a reply removes its thread record on both participants', async () => {
  const r = await room();
  const before = await savedXml(r.alice);
  const parent = r.alice.getReviewItems().find((item) => item.kind === 'comment')!;
  expect(r.alice.replyToReviewItem(parent.key, 'A reply').ok).toBe(true);
  r.sync();
  expect((await savedXml(r.bob))['word/commentsExtended.xml']).not.toBe(
    before['word/commentsExtended.xml']
  );
  expect(r.alice.exec({ type: 'undo' }).ok).toBe(true);
  r.sync();
  expect(await savedXml(r.alice)).toEqual(before);
  expect(await savedXml(r.bob)).toEqual(before);
});

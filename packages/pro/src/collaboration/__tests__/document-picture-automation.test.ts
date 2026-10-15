/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Inline pictures inserted through the document API on collaborating replicas (#1348).
//
// A collaborative replica mints the picture's `wp:docPr/@id`, relationship id and media part
// name from its actor's id stripe. The batch planner previews that allocation and the commit
// makes it, so both must see the same actor, or the commit refuses its own plan. These tests
// cover the headless runtime, the browser runtime, concurrent inserts from one snapshot,
// undo and redo, and a concurrent deletion of the paragraph the picture goes into.

import { afterAll, describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor, type DocxEditorRuntime } from '@docx-editor.dev/editor-api/browser';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

/** 1x1 PNG. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const BODY_XML =
  '<w:p><w:r><w:t>First paragraph</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p><w:sectPr/>';

type Kind = 'headless' | 'browser';

interface Replica {
  readonly peer: Peer;
  readonly runtime: DocxEditorRuntime;
  readonly editor: ReturnType<typeof createDocxEditor> | null;
  save(): Promise<Uint8Array>;
}

async function replica(peer: Peer, kind: Kind, cleanups: (() => void)[]): Promise<Replica> {
  peer.detach();
  if (kind === 'headless') {
    const runtime = await DocxEditor.createCollaborative(peer.room.document, peer.room.session, {
      author: 'Agent',
    });
    cleanups.push(() => runtime.dispose());
    return { peer, runtime, editor: null, save: () => runtime.save() };
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = createDocxEditor({
    container,
    document: peer.room.document,
    modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
  });
  const runtime = DocxEditor.createBrowser(editor, { author: 'Writer' });
  cleanups.push(() => {
    runtime.dispose();
    editor.destroy();
    container.remove();
  });
  return {
    peer,
    runtime,
    editor,
    save: async () => new Uint8Array(await editor.save()),
  };
}

async function room(kinds: readonly [Kind, Kind]) {
  const harness = createPeerHarness(`picture-automation-${kinds.join('-')}`);
  const pair = await harness.pair(zipDocument(BODY_XML));
  const cleanups: (() => void)[] = [];
  const [alice, bob] = [
    await replica(pair.alice, kinds[0], cleanups),
    await replica(pair.bob, kinds[1], cleanups),
  ];
  return {
    alice,
    bob,
    pause: pair.pause,
    resume: pair.resume,
    flush() {
      for (const peer of [alice, bob]) peer.peer.room.session.flushPendingJournals();
    },
    close() {
      for (const cleanup of cleanups.reverse()) cleanup();
      harness.cleanup();
    },
  };
}

/** Insert one picture at the end of the paragraph at `index`, then size it when asked. */
async function insertPicture(runtime: DocxEditorRuntime, index: number, width?: number) {
  await runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items');
    await context.sync();
    const picture = paragraphs.items[index]!.getRange('End').insertInlinePictureFromBase64(
      PNG,
      'Before'
    );
    await context.sync();
    if (width === undefined) return;
    picture.width = width;
    await context.sync();
  });
}

async function pictureWidths(runtime: DocxEditorRuntime): Promise<number[]> {
  return runtime.run(async (context) => {
    const pictures = context.document.body.inlinePictures;
    pictures.load('items');
    await context.sync();
    for (const picture of pictures.items) picture.load('width');
    await context.sync();
    return pictures.items.map((picture) => picture.width);
  });
}

interface SavedPictures {
  readonly documentXml: string;
  readonly docPrIds: string[];
  readonly embeds: string[];
  readonly imageTargets: Map<string, string>;
  readonly media: string[];
}

function savedPictures(bytes: Uint8Array): SavedPictures {
  const files = unzipSync(bytes);
  const documentXml = strFromU8(files['word/document.xml']!);
  const rels = files['word/_rels/document.xml.rels'];
  const imageTargets = new Map<string, string>();
  for (const match of (rels ? strFromU8(rels) : '').matchAll(/<Relationship\b[^>]*\/>/g)) {
    const tag = match[0];
    if (!tag.includes('/relationships/image"')) continue;
    imageTargets.set(/\bId="([^"]+)"/.exec(tag)![1]!, /\bTarget="([^"]+)"/.exec(tag)![1]!);
  }
  return {
    documentXml,
    docPrIds: [...documentXml.matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)].map((m) => m[1]!),
    embeds: [...documentXml.matchAll(/<a:blip\b[^>]*\br:embed="([^"]+)"/g)].map((m) => m[1]!),
    imageTargets,
    media: Object.keys(files)
      .filter((name) => name.startsWith('word/media/'))
      .sort(),
  };
}

/** Every drawing resolves to its own relationship and its own media part. */
function expectWellFormed(saved: SavedPictures, count: number) {
  expect(saved.docPrIds).toHaveLength(count);
  expect(new Set(saved.docPrIds).size).toBe(count);
  expect(saved.embeds).toHaveLength(count);
  expect(new Set(saved.embeds).size).toBe(count);
  const targets = saved.embeds.map((id) => saved.imageTargets.get(id));
  for (const target of targets) expect(target).toBeDefined();
  expect(new Set(targets).size).toBe(count);
  expect(saved.media).toEqual(targets.map((target) => `word/${target!}`).sort());
}

async function expectConverged(state: Awaited<ReturnType<typeof room>>, count: number) {
  state.flush();
  const [left, right] = await Promise.all([state.alice.save(), state.bob.save()]);
  const [leftPictures, rightPictures] = [savedPictures(left), savedPictures(right)];
  expect(rightPictures.documentXml).toBe(leftPictures.documentXml);
  expect(rightPictures.media).toEqual(leftPictures.media);
  expectWellFormed(leftPictures, count);
  expectWellFormed(rightPictures, count);
  const reopened = await DocxEditor.createServer(left);
  try {
    expect(await pictureWidths(reopened)).toHaveLength(count);
  } finally {
    reopened.dispose();
  }
  return leftPictures;
}

describe.each([
  ['headless', 'browser'],
  ['browser', 'headless'],
] as const)('insertInlinePictureFromBase64 on a collaborative %s runtime', (inserter, other) => {
  test('commits, replicates to the peer, and survives save and reopen', async () => {
    const state = await room([inserter, other]);
    try {
      await insertPicture(state.alice.runtime, 0, 20);
      state.flush();
      expect(await pictureWidths(state.alice.runtime)).toEqual([20]);
      expect(await pictureWidths(state.bob.runtime)).toEqual([20]);
      await expectConverged(state, 1);
    } finally {
      state.close();
    }
  });
});

describe('concurrent picture inserts', () => {
  test('two replicas inserting from one snapshot keep distinct ids and media parts', async () => {
    const state = await room(['headless', 'headless']);
    try {
      state.pause();
      await insertPicture(state.alice.runtime, 0, 20);
      await insertPicture(state.bob.runtime, 1, 30);
      state.resume();
      state.flush();
      expect((await pictureWidths(state.alice.runtime)).sort()).toEqual([20, 30]);
      expect((await pictureWidths(state.bob.runtime)).sort()).toEqual([20, 30]);
      await expectConverged(state, 2);
    } finally {
      state.close();
    }
  });

  test('a picture inserted while the peer deletes its paragraph converges', async () => {
    const state = await room(['headless', 'browser']);
    try {
      state.pause();
      await insertPicture(state.alice.runtime, 1);
      await state.bob.runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load('items');
        await context.sync();
        paragraphs.items[1]!.getRange('Content').delete();
        await context.sync();
      });
      state.resume();
      const saved = await expectConverged(state, 1);
      expect(saved.documentXml).not.toContain('Second paragraph');
    } finally {
      state.close();
    }
  });
});

describe('undo and redo of a scripted picture', () => {
  test('replicates the removal and the restore', async () => {
    const state = await room(['browser', 'headless']);
    try {
      await insertPicture(state.alice.runtime, 0);
      state.flush();
      expect(await pictureWidths(state.bob.runtime)).toEqual([0.75]);

      expect(state.alice.editor!.exec({ type: 'undo' })).toMatchObject({ ok: true });
      state.flush();
      expect(await pictureWidths(state.alice.runtime)).toEqual([]);
      expect(await pictureWidths(state.bob.runtime)).toEqual([]);

      expect(state.alice.editor!.exec({ type: 'redo' })).toMatchObject({ ok: true });
      state.flush();
      expect(await pictureWidths(state.bob.runtime)).toEqual([0.75]);
      await expectConverged(state, 1);
    } finally {
      state.close();
    }
  });
});

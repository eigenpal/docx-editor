/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { initializeHarfBuzz, sha256FontBytes } from '@docx-editor.dev/core/layout';
import type { FontConfiguration } from '@docx-editor.dev/core/contracts/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

beforeAll(() => initializeHarfBuzz());
const configuration = (): FontConfiguration => {
  const bytes = new Uint8Array(
    readFileSync(
      new URL(
        '../../../../core/src/layout/__tests__/fixtures/fonts/DejaVuSans.ttf',
        import.meta.url
      )
    )
  );
  return {
    epoch: 1,
    maxFontBytes: 16 * 1024 * 1024,
    sources: [
      {
        request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
        id: 'peer-public-dejavu',
        bytes,
        hash: sha256FontBytes(bytes),
        faceIndex: 0,
      },
    ],
    defaultFont: { family: 'DejaVu Sans', sizeHalfPoints: 22 },
  };
};
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error('The real shared editor state did not converge');
}

test('local font revocation preserves two-peer edits, history, presence, deletion, and save', async () => {
  const harness = createPeerHarness('public-set-fonts');
  const views: { editor: DocxEditorInstance; container: HTMLElement }[] = [];
  const mount = (peer: Peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
      fonts: configuration(),
    });
    const view = { editor, container };
    views.push(view);
    return view;
  };
  const xml = async (editor: DocxEditorInstance) =>
    strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  try {
    const pair = await harness.pair(
      zipDocument(
        '<w:p><w:r><w:rPr><w:rFonts w:ascii="DejaVu Sans" w:hAnsi="DejaVu Sans"/></w:rPr><w:t>AB</w:t></w:r></w:p>'
      )
    );
    const left = mount(pair.alice),
      right = mount(pair.bob);
    await until(() =>
      views.every(
        (view) =>
          view.editor.fontMeasurement().measurer === 'shaped' &&
          !view.editor.fontMeasurement().resolving
      )
    );
    const session = left.editor.surface!.session,
      id = harness.paragraphIdAt(pair.alice, 0);
    const select = (editor: DocxEditorInstance, start: number, end = start) =>
      editor.exec({
        type: 'setSelection',
        range: {
          anchor: { paragraphId: id, offset: start },
          head: { paragraphId: id, offset: end },
        },
      });
    const flush = () => {
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
    };
    const shared = async (expected: string) => {
      flush();
      await until(() =>
        views.every((view) => view.editor.surface!.session.bodyText() === expected)
      );
      expect(await xml(left.editor)).toBe(await xml(right.editor));
      expect(JSON.stringify(pair.alice.awareness.getLocalState())).not.toContain('public-dejavu');
    };
    pair.pause();
    select(left.editor, 0);
    select(right.editor, 2);
    expect(left.editor.exec({ type: 'insertText', text: 'L' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'R' }).ok).toBe(true);
    await left.editor.setFonts(undefined);
    flush();
    pair.resume();
    await shared('LABR');
    expect(left.editor.surface!.session).toBe(session);
    expect(left.editor.fontMeasurement().measurer).toBe('fixed');
    expect(right.editor.fontMeasurement().measurer).toBe('shaped');
    expect(left.editor.exec({ type: 'undo' }).ok).toBe(true);
    await shared('ABR');
    expect(left.editor.exec({ type: 'redo' }).ok).toBe(true);
    await shared('LABR');
    select(right.editor, 2);
    applyAwarenessUpdate(
      pair.alice.awareness,
      encodeAwarenessUpdate(pair.bob.awareness, [pair.bob.awareness.clientID]),
      'test-provider'
    );
    const caret = left.container.querySelector<HTMLElement>('.docx-remote-caret');
    expect(caret).not.toBeNull();
    expect(parseFloat(caret!.style.height)).toBeGreaterThan(0);
    pair.pause();
    select(left.editor, 1, 3);
    select(right.editor, 2);
    expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'X' }).ok).toBe(true);
    flush();
    pair.resume();
    await shared('LXR');
    const cold = document.createElement('div');
    document.body.append(cold);
    const reopened = createDocxEditor({
      container: cold,
      document: new Uint8Array(await left.editor.save()),
    });
    try {
      await until(() => !!reopened.surface);
      expect(reopened.surface!.session.bodyText()).toBe('LXR');
      expect(reopened.snapshot().canUndo).toBe(false);
    } finally {
      reopened.destroy();
      cold.remove();
    }
  } finally {
    for (const view of views) {
      view.editor.destroy();
      view.container.remove();
    }
    harness.cleanup();
  }
}, 10000);

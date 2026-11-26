/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A glyph fallback face loads on each peer by itself: fonts are local, never shared state.
// A symbol that one peer types reaches the other as a text edit, and the other peer's own
// layout then asks its own host for the fallback face. Both lay the line out in one face.
import { beforeAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { initializeHarfBuzz } from '@docx-editor.dev/core/layout';
import { packagedFonts } from '../../../../fonts/src/index.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';

beforeAll(() => initializeHarfBuzz());

const assets = new URL('../../../../fonts/assets/', import.meta.url);
const SYMBOL_FACE = 'NotoSansSymbols2-Regular.ttf';

async function until(check: () => boolean) {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error('The shared editors did not converge');
}

test('a symbol typed by one peer loads the fallback face on both peers', async () => {
  const harness = createPeerHarness('glyph-fallback-fonts');
  const views: { editor: DocxEditorInstance; container: HTMLElement; fetched: string[] }[] = [];
  const mount = (peer: Peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.append(container);
    const fetched: string[] = [];
    const fetcher = ((input: RequestInfo | URL) => {
      const url = String(input);
      const file = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
      fetched.push(file);
      return Promise.resolve(new Response(new Uint8Array(readFileSync(new URL(file, assets)))));
    }) as typeof fetch;
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
      fonts: packagedFonts({ fetcher, onFailure: () => {} }),
    });
    const view = { editor, container, fetched };
    views.push(view);
    return view;
  };
  const settled = () =>
    until(() =>
      views.every(
        (view) =>
          view.editor.fontMeasurement().measurer === 'shaped' &&
          !view.editor.fontMeasurement().resolving
      )
    );
  const lineHeights = (view: (typeof views)[number]) =>
    [...view.container.querySelectorAll<HTMLElement>('.docx-line')].map(
      (line) => line.style.height
    );
  const xml = async (editor: DocxEditorInstance) =>
    strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  try {
    const pair = await harness.pair(
      zipDocument(
        '<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr><w:t>AB</w:t></w:r></w:p>'
      )
    );
    const left = mount(pair.alice),
      right = mount(pair.bob);
    await settled();
    // The text is covered: neither peer loaded a fallback face.
    expect(views.flatMap((view) => view.fetched)).not.toContain(SYMBOL_FACE);
    const plain = lineHeights(left);
    expect(lineHeights(right)).toEqual(plain);

    const id = harness.paragraphIdAt(pair.alice, 0);
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
      await settled();
      expect(await xml(left.editor)).toBe(await xml(right.editor));
      expect(lineHeights(right)).toEqual(lineHeights(left));
    };

    // Concurrent edits: one peer types a symbol that Arial lacks, the other types a letter.
    pair.pause();
    select(left.editor, 0);
    select(right.editor, 2);
    expect(left.editor.exec({ type: 'insertText', text: '☐' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: 'R' }).ok).toBe(true);
    flush();
    pair.resume();
    await shared('☐ABR');
    await until(() => views.every((view) => view.fetched.includes(SYMBOL_FACE)));
    await settled();
    // Each peer asked its own host, and both lines took the height of the symbol face.
    expect(lineHeights(left)).not.toEqual(plain);
    expect(lineHeights(right)).toEqual(lineHeights(left));
    // The fonts of a peer are not shared state.
    expect(JSON.stringify(pair.alice.awareness.getLocalState())).not.toContain('Noto');

    // Undo and redo of the symbol, on its author.
    expect(left.editor.exec({ type: 'undo' }).ok).toBe(true);
    await shared('ABR');
    expect(lineHeights(left)).toEqual(plain);
    expect(left.editor.exec({ type: 'redo' }).ok).toBe(true);
    await shared('☐ABR');
    expect(lineHeights(left)).not.toEqual(plain);

    // One peer deletes the symbol while the other edits beside it.
    pair.pause();
    select(left.editor, 0, 1);
    select(right.editor, 4);
    expect(left.editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(right.editor.exec({ type: 'insertText', text: '☒' }).ok).toBe(true);
    flush();
    pair.resume();
    await shared('ABR☒');
    // The face is held for the document: no peer fetched it twice.
    for (const view of views)
      expect(view.fetched.filter((file) => file === SYMBOL_FACE)).toHaveLength(1);

    // Save and reopen: the reopened document lays the symbol out in the same face.
    const cold = document.createElement('div');
    document.body.append(cold);
    const reopened = {
      container: cold,
      fetched: [] as string[],
      editor: createDocxEditor({
        container: cold,
        document: new Uint8Array(await left.editor.save()),
        fonts: packagedFonts({
          fetcher: ((input: RequestInfo | URL) => {
            const url = String(input);
            const file = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
            return Promise.resolve(
              new Response(new Uint8Array(readFileSync(new URL(file, assets))))
            );
          }) as typeof fetch,
          onFailure: () => {},
        }),
      }),
    };
    try {
      await until(() => !!reopened.editor.surface);
      expect(reopened.editor.surface!.session.bodyText()).toBe('ABR☒');
      await until(() => lineHeights(reopened).join() === lineHeights(left).join());
    } finally {
      reopened.editor.destroy();
      cold.remove();
    }
  } finally {
    for (const view of views) {
      view.editor.destroy();
      view.container.remove();
    }
    harness.cleanup();
  }
}, 30000);

/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// pro-licensing, v1 honor system: a module without a key is fully functional
// and silent, and NOTHING about licensing touches the network — pinned by
// spying on fetch for the whole construction + registration + use cycle.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const TRACKED =
  `<w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r>` +
  `<w:ins w:id="1" w:author="Ada" w:date="2024-01-01T00:00:00Z">` +
  `<w:r><w:t>added</w:t></w:r></w:ins></w:p>`;

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

describe('reviewModule without a key (honor system)', () => {
  test('fully functional, silent, and offline', () => {
    const fetchCalls: unknown[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => {
      fetchCalls.push(args);
      throw new Error('licensing must never touch the network');
    }) as unknown as typeof fetch;
    const warnings: unknown[] = [];
    const realWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      const container = document.createElement('div');
      const editor = createDocxEditor({
        container,
        document: docx(TRACKED),
        author: 'Grace Hopper',
        modules: [reviewModule({})],
      });
      expect(editor.surface).not.toBeNull();
      expect(editor.getReviewItems().length).toBeGreaterThan(0);
      expect(editor.can({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
      expect(editor.exec({ type: 'toggleReviewPane' }).ok).toBe(true);
      expect(warnings).toEqual([]);
      expect(fetchCalls).toEqual([]);
      editor.destroy();
    } finally {
      globalThis.fetch = realFetch;
      console.warn = realWarn;
    }
  });

  test('a key is accepted and equally silent', () => {
    const module = reviewModule({ licenseKey: 'DOCXPRO.not-verified-in-v1' });
    expect(module.id).toBe('review');
    expect(module.review).toBeDefined();
  });
});

describe('the free packages carry no review derivation', () => {
  test('core layout no longer exports the queue derivation', async () => {
    const layout = await import('@docx-editor.dev/core/layout');
    // The vocabulary and pure helpers stay; the derivation is this package's.
    expect('reviewItemKey' in layout).toBe(true);
    expect('collectReviewItems' in layout).toBe(false);
    expect('revisionItemsOf' in layout).toBe(false);
    expect('commentAnchorsOfStory' in layout).toBe(false);
    expect('commentsOfPart' in layout).toBe(false);
  });
});

describe('review pane opening', () => {
  const PLAIN = `<w:p><w:r><w:t>Plain words</w:t></w:r></w:p>`;

  function open(body: string, opening?: 'auto' | 'manual') {
    return createDocxEditor({
      container: document.createElement('div'),
      document: docx(body),
      author: 'Grace Hopper',
      modules: [reviewModule(opening ? { pane: { opening } } : {})],
    });
  }

  function typeTracked(editor: ReturnType<typeof open>) {
    editor.setEditingMode('suggesting');
    const paragraphId = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 0 },
    });
    editor.surface!.type('x');
  }

  test('by default the pane opens on a document with review items', () => {
    const editor = open(TRACKED);
    expect(editor.isReviewPaneOpen()).toBe(true);
    editor.destroy();
  });

  test('by default the first tracked change opens the pane', () => {
    const editor = open(PLAIN);
    expect(editor.isReviewPaneOpen()).toBe(false);
    typeTracked(editor);
    expect(editor.getReviewItems().length).toBeGreaterThan(0);
    expect(editor.isReviewPaneOpen()).toBe(true);
    editor.destroy();
  });

  test('manual keeps the pane closed on load and after a tracked change', () => {
    const loaded = open(TRACKED, 'manual');
    expect(loaded.getReviewItems().length).toBeGreaterThan(0);
    expect(loaded.isReviewPaneOpen()).toBe(false);
    loaded.destroy();

    const edited = open(PLAIN, 'manual');
    typeTracked(edited);
    expect(edited.getReviewItems().length).toBeGreaterThan(0);
    expect(edited.isReviewPaneOpen()).toBe(false);
    edited.destroy();
  });

  test('an unknown field or value is refused, not read as the default', () => {
    const badValue = { pane: { opening: 'Manual' } } as unknown as { pane: { opening: 'manual' } };
    expect(() => reviewModule(badValue)).toThrow(TypeError);
    const badField = { pane: { openning: 'manual' } } as unknown as { pane: { opening: 'manual' } };
    expect(() => reviewModule(badField)).toThrow(TypeError);
    // The old spelling of the default is refused too.
    const oldValue = { pane: { opening: 'automatic' } } as unknown as { pane: { opening: 'auto' } };
    expect(() => reviewModule(oldValue)).toThrow(TypeError);
  });

  test('under balloons, tracked changes alone never open the pane', () => {
    // The pane lists comments only in this mode, so it would open empty.
    const loaded = createDocxEditor({
      container: document.createElement('div'),
      document: docx(TRACKED),
      author: 'Grace Hopper',
      modules: [reviewModule({ pane: { revisionsIn: 'balloons' } })],
    });
    expect(loaded.getReviewItems().length).toBeGreaterThan(0);
    expect(loaded.isReviewPaneOpen()).toBe(false);
    loaded.destroy();

    const edited = createDocxEditor({
      container: document.createElement('div'),
      document: docx(PLAIN),
      author: 'Grace Hopper',
      modules: [reviewModule({ pane: { revisionsIn: 'balloons' } })],
    });
    typeTracked(edited);
    expect(edited.getReviewItems().length).toBeGreaterThan(0);
    expect(edited.isReviewPaneOpen()).toBe(false);
    // Back to the pane: the next load with tracked changes opens it again.
    edited.setReviewPane({ revisionsIn: 'pane' });
    edited.load(docx(TRACKED));
    expect(edited.isReviewPaneOpen()).toBe(true);
    edited.destroy();
  });

  test('switching an open pane to balloons closes it when nothing is left to list', () => {
    const editor = open(TRACKED);
    expect(editor.isReviewPaneOpen()).toBe(true);
    expect(editor.setReviewPane({ revisionsIn: 'balloons' }).ok).toBe(true);
    // The document holds tracked changes only, and they now open in balloons.
    expect(editor.isReviewPaneOpen()).toBe(false);
    // Back to the pane: the reader opens it again when they want it.
    expect(editor.setReviewPane({ revisionsIn: 'pane' }).ok).toBe(true);
    expect(editor.isReviewPaneOpen()).toBe(false);
    editor.destroy();
  });

  test('without a review module, setReviewPane is refused and changes nothing', () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(PLAIN),
    });
    const before = editor.snapshot().reviewPane;
    expect(editor.setReviewPane({ opening: 'manual' })).toMatchObject({
      ok: false,
      code: 'unsupported',
    });
    expect(editor.snapshot().reviewPane).toBe(before);
    editor.destroy();
  });

  test('manual stays in force across a second load', () => {
    const editor = open(PLAIN, 'manual');
    expect(editor.snapshot().reviewPane?.opening).toBe('manual');
    editor.load(docx(TRACKED));
    expect(editor.getReviewItems().length).toBeGreaterThan(0);
    expect(editor.isReviewPaneOpen()).toBe(false);
    editor.load(docx(TRACKED));
    expect(editor.isReviewPaneOpen()).toBe(false);
    editor.destroy();
  });

  test('setReviewPane changes the opening at runtime, and invalid settings change nothing', () => {
    const editor = open(PLAIN);
    const before = editor.snapshot().reviewPane;
    expect(before).toEqual({
      opening: 'auto',
      overflow: 'float',
      revisionsIn: 'pane',
      commentMarkers: 'initials',
    });
    editor.setReviewPane({ opening: 'manual' });
    expect(editor.snapshot().reviewPane).toMatchObject({ opening: 'manual', overflow: 'float' });
    typeTracked(editor);
    expect(editor.isReviewPaneOpen()).toBe(false);
    // An unchanged value keeps the snapshot's reference.
    const same = editor.snapshot().reviewPane;
    editor.setReviewPane({ opening: 'manual' });
    expect(editor.snapshot().reviewPane).toBe(same);
    const bad = { overflow: 'scrollPage' } as unknown as { overflow: 'float' };
    expect(editor.setReviewPane(bad)).toMatchObject({ ok: false, code: 'invalidArgs' });
    expect(editor.snapshot().reviewPane).toBe(same);
    editor.setReviewPane({ opening: 'auto' });
    editor.load(docx(TRACKED));
    expect(editor.isReviewPaneOpen()).toBe(true);
    editor.destroy();
  });

  test('manual still lets the host open and close the pane', () => {
    const editor = open(TRACKED, 'manual');
    expect(editor.exec({ type: 'toggleReviewPane' }).ok).toBe(true);
    expect(editor.isReviewPaneOpen()).toBe(true);
    expect(editor.exec({ type: 'toggleReviewPane' }).ok).toBe(true);
    expect(editor.isReviewPaneOpen()).toBe(false);
    editor.destroy();
  });
});

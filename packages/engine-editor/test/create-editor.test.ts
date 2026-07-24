// The production createEditor lifecycle (4.3): byte-native load/save, layout -> onDisplay, revision
// change events, handle, and disposal. Headless — the host's body element is null so no ProseMirror
// view mounts (that path is covered by the paired browser smoke tests); this proves the composition
// wiring the adapters depend on.

import { describe, expect, test } from 'bun:test';
import { createEditor } from '../src/index.ts';
import type { EditorHost } from '@docx-editor.dev/core-contract/editor';
import type { DisplayPage } from '@docx-editor.dev/core-contract/geometry';
import { createEmptyModel, writeDocx } from '@docx-editor.dev/engine-core';

// A minimal, real DOCX: the empty authored model serialized to bytes.
const docxBytes = (): Uint8Array => writeDocx(createEmptyModel());

function makeHost(over: Partial<EditorHost> = {}): { host: EditorHost; displays: DisplayPage[][]; totals: number[] } {
  const displays: DisplayPage[][] = [];
  const totals: number[] = [];
  const host: EditorHost = {
    getBodyHostEl: () => null, // headless: no PM mount
    getHfHostEl: () => null,
    getPagesContainer: () => null,
    getScrollContainer: () => null,
    scheduleFrame: (cb) => {
      cb();
      return () => {};
    },
    onDisplay: (pages) => displays.push([...pages]),
    onTotalPages: (n) => totals.push(n),
    ...over,
  };
  return { host, displays, totals };
}

describe('createEditor lifecycle (byte-native, PM-free host)', () => {
  test('loading bytes lays out and delivers a contract DisplayPage[] to the host', () => {
    const { host, displays, totals } = makeHost();
    const editor = createEditor({ host, document: docxBytes() });
    expect(displays.length).toBeGreaterThan(0);
    expect(displays.at(-1)!.length).toBeGreaterThan(0);
    expect(displays.at(-1)![0].box.width).toBe(816); // US Letter in px
    expect(totals.at(-1)).toBe(editor.getTotalPages());
    editor.destroy();
  });

  test('getDisplay mirrors the delivered pages and getPageGeometry lists page boxes', () => {
    const { host } = makeHost();
    const editor = createEditor({ host, document: docxBytes() });
    expect(editor.getDisplay().length).toBe(editor.getTotalPages());
    expect(editor.getPageGeometry().map((p) => p.index)).toEqual(editor.getDisplay().map((p) => p.index));
    editor.destroy();
  });

  test('save() returns real DOCX bytes that reopen', () => {
    const { host } = makeHost();
    const editor = createEditor({ host, document: docxBytes() });
    return editor.save().then((buf) => {
      expect(buf.byteLength).toBeGreaterThan(0);
      // PK zip signature.
      const sig = new Uint8Array(buf).slice(0, 2);
      expect([sig[0], sig[1]]).toEqual([0x50, 0x4b]);
    }).finally(() => editor.destroy());
  });

  test('getDocumentHandle carries a revision; change listeners subscribe/unsubscribe', () => {
    const { host } = makeHost();
    const editor = createEditor({ host, document: docxBytes() });
    expect(typeof editor.getDocumentHandle().revision).toBe('number');
    let hits = 0;
    const off = editor.on('change', () => (hits += 1));
    off();
    editor.relayout();
    expect(hits).toBe(0); // unsubscribed
    editor.destroy();
  });

  test('the deferred command/query surface degrades gracefully instead of throwing', () => {
    const { host } = makeHost();
    const editor = createEditor({ host, document: docxBytes() });
    expect(editor.exec({ type: 'toggleMark', mark: 'bold' })).toMatchObject({ ok: false, code: 'unsupported' });
    expect(editor.query({ type: 'selectedText' })).toBe('');
    expect(editor.snapshot().page.total).toBe(editor.getTotalPages());
    editor.destroy();
  });

  test('array-typed queries return [] (a consumer may .map without crashing)', () => {
    const { host } = makeHost();
    const editor = createEditor({ host, document: docxBytes() });
    // trackedChanges is declared as an array; a null would crash a consumer calling .map.
    const tracked = editor.query({ type: 'trackedChanges' });
    expect(Array.isArray(tracked)).toBe(true);
    expect(() => (tracked as unknown[]).map((x) => x)).not.toThrow();
    editor.destroy();
  });

  test('a document handle is a same-store hand-off (not a byte clone)', async () => {
    const a = createEditor({ host: makeHost().host, document: docxBytes() });
    const handle = a.getDocumentHandle();
    expect(typeof handle.revision).toBe('number');
    // A second editor loads the handle: it shares A's exact store, so its handle tracks the same
    // live revision and its save reproduces the identical document.
    const { host, displays } = makeHost();
    const b = createEditor({ host, document: handle });
    expect(displays.length).toBeGreaterThan(0); // loaded + painted, no error
    expect(b.getDocumentHandle().revision).toBe(handle.revision); // same live revision source
    const [ba, bb] = [await a.save(), await b.save()];
    expect(new Uint8Array(bb)).toEqual(new Uint8Array(ba)); // same store -> identical bytes
    // A shared-handle editor is a read-only view (no competing edit surface) — deferred collab.
    expect(b.snapshot().editable).toBe(false);
    a.destroy();
    b.destroy();
  });

  test('mode:"view" opens read-only even for a patchable document (no edit surface mounted)', () => {
    // A real DOM body element is provided; in edit mode this would mount a PM surface. In view mode
    // it must not — proven by focus() being a no-op (no surface) while display still renders.
    const bodyEl = { ownerDocument: undefined } as unknown as HTMLElement;
    const { host, displays } = makeHost({ getBodyHostEl: () => bodyEl });
    const editor = createEditor({ host, document: docxBytes(), mode: 'view' });
    expect(displays.length).toBeGreaterThan(0); // renders read-only
    expect(() => editor.focus()).not.toThrow(); // no surface, inert focus
    editor.destroy();
  });

  test('destroy clears the display list and blocks new listeners', () => {
    const { host } = makeHost();
    const editor = createEditor({ host, document: docxBytes() });
    editor.destroy();
    expect(editor.getDisplay()).toEqual([]);
    let hits = 0;
    const off = editor.on('display', () => (hits += 1));
    editor.relayout(); // destroyed: no-op
    expect(hits).toBe(0);
    expect(() => off()).not.toThrow();
  });

  test('a display listener fires on relayout with the same pages', () => {
    const { host } = makeHost();
    const editor = createEditor({ host, document: docxBytes() });
    let last: readonly DisplayPage[] = [];
    editor.on('display', (pages) => (last = pages));
    editor.relayout();
    expect(last.length).toBe(editor.getTotalPages());
    editor.destroy();
  });
});

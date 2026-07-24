// The stable engine-neutral EditorDriver (comprehensive 4.7): the automation surface both adapters
// expose so the SAME browser scenarios drive React and Vue. Headless coverage of the surface.

import { describe, expect, test } from 'bun:test';
import { createEditor, createEditorDriver, displayText } from '../src/index.ts';
import type { EditorHost } from '@docx-editor.dev/core-contract/editor';
import type { DisplayPage } from '@docx-editor.dev/core-contract/geometry';
import { createEmptyModel, writeDocx } from '@docx-editor.dev/engine-core';

const docxBytes = (): Uint8Array => writeDocx(createEmptyModel());
function nullHost(): EditorHost {
  return {
    getBodyHostEl: () => null,
    getHfHostEl: () => null,
    getPagesContainer: () => null,
    getScrollContainer: () => null,
    scheduleFrame: (cb) => {
      cb();
      return () => {};
    },
  };
}

describe('EditorDriver over the production editor', () => {
  test('exposes editability, a display snapshot, save, reopen, and dispose', async () => {
    const editor = createEditor({ host: nullHost(), document: docxBytes() });
    const driver = createEditorDriver(editor);

    expect(typeof driver.editable()).toBe('boolean');
    const snap = driver.displaySnapshot();
    expect(snap.pageCount).toBeGreaterThan(0);
    expect(typeof snap.text).toBe('string');

    const buf = await driver.save();
    expect(new Uint8Array(buf).slice(0, 2)).toEqual(new Uint8Array([0x50, 0x4b])); // PK

    // Reopen round-trips headlessly and returns the reopened display text.
    const reopened = await driver.saveAndReopenText();
    expect(reopened).toBe(driver.displaySnapshot().text);

    driver.dispose();
    expect(editor.getDisplay()).toEqual([]); // disposed the underlying editor
  });

  test('deferred command/query degrade through the driver too', () => {
    const editor = createEditor({ host: nullHost(), document: docxBytes() });
    const driver = createEditorDriver(editor);
    expect(driver.exec({ type: 'toggleMark', mark: 'bold' })).toMatchObject({ ok: false, code: 'unsupported' });
    expect(Array.isArray(driver.query({ type: 'paragraphs' }))).toBe(true);
    expect(driver.selection()).toBeNull();
    driver.dispose();
  });

  test('pageText reconstructs spacing from box geometry (tight word, gap = space, line = newline)', async () => {
    const { pageText } = await import('../src/driver.ts');
    const run = (t: string) => ({ text: t, box: { x: 0, y: 0, width: 0, height: 0 }, fontFamily: 'A', fontSizePx: 5, color: { kind: 'auto' as const } });
    const t = (x: number, y: number, width: number, text: string) => ({
      kind: 'text' as const,
      box: { x, y, width, height: 10 },
      runs: [run(text)],
      docFrom: 0,
      docTo: text.length,
      blockId: 0,
      scope: { kind: 'body' as const },
    });
    const page: DisplayPage = {
      index: 0,
      box: { x: 0, y: 0, width: 100, height: 100 },
      // "Hel"+"lo" contiguous (one word), then a gap before "world", then a new line "next".
      items: [t(0, 0, 30, 'Hel'), t(30, 0, 20, 'lo'), t(60, 0, 40, 'world'), t(0, 20, 40, 'next')],
    };
    expect(pageText(page)).toBe('Hello world\nnext');
  });

  test('displayText joins page text with newlines', () => {
    const pages: DisplayPage[] = [
      { index: 0, box: { x: 0, y: 0, width: 10, height: 10 }, items: [{ kind: 'text', box: { x: 0, y: 0, width: 5, height: 5 }, runs: [{ text: 'hi', box: { x: 0, y: 0, width: 5, height: 5 }, fontFamily: 'A', fontSizePx: 5, color: { kind: 'auto' } }], docFrom: 0, docTo: 2, blockId: 0, scope: { kind: 'body' } }] },
      { index: 1, box: { x: 0, y: 0, width: 10, height: 10 }, items: [] },
    ];
    expect(displayText(pages)).toBe('hi\n');
  });
});

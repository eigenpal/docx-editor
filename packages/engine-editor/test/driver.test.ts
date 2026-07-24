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

  test('displayText joins page text with newlines', () => {
    const pages: DisplayPage[] = [
      { index: 0, box: { x: 0, y: 0, width: 10, height: 10 }, items: [{ kind: 'text', box: { x: 0, y: 0, width: 5, height: 5 }, runs: [{ text: 'hi', box: { x: 0, y: 0, width: 5, height: 5 }, fontFamily: 'A', fontSizePx: 5, color: { kind: 'auto' } }], docFrom: 0, docTo: 2, blockId: 0, scope: { kind: 'body' } }] },
      { index: 1, box: { x: 0, y: 0, width: 10, height: 10 }, items: [] },
    ];
    expect(displayText(pages)).toBe('hi\n');
  });
});

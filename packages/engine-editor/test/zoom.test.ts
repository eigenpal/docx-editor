// Engine-owned zoom (`getZoom` / `setZoom`).
//
// Zoom used to be a host prop the engine only carried in `snapshot()`, which let a host
// paint at one scale while hit testing divided by another. These cases pin the contract:
// the value round-trips, out-of-range input is REFUSED rather than clamped, and a no-op
// set reports that nothing changed.

import { describe, expect, test } from 'bun:test';
import { createTestEditor as createEditor } from './create-test-editor.ts';
import type { Editor, EditorHost } from '@docx-editor.dev/core-contract/contracts/editor';
import { createEmptyModel, writeDocx } from '@docx-editor.dev/engine-core';

function host(): EditorHost {
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

const editorAt = (zoom?: number): Editor =>
  createEditor({
    host: host(),
    document: writeDocx(createEmptyModel()),
    ...(zoom === undefined ? {} : { zoom }),
  });

describe('zoom', () => {
  test('defaults to 1 and reads back what config seeded', () => {
    const a = editorAt();
    expect(a.getZoom()).toBe(1);
    a.destroy();

    const b = editorAt(1.5);
    expect(b.getZoom()).toBe(1.5);
    b.destroy();
  });

  test('setZoom round-trips and reports the change', () => {
    const editor = editorAt();
    const result = editor.setZoom(2);
    expect(result.ok).toBe(true);
    expect(result.ok && result.changed).toBe(true);
    expect(editor.getZoom()).toBe(2);
    editor.destroy();
  });

  test('setting the value it already has changes nothing', () => {
    const editor = editorAt(1.25);
    const result = editor.setZoom(1.25);
    expect(result.ok).toBe(true);
    expect(result.ok && result.changed).toBe(false);
    editor.destroy();
  });

  test('out-of-range and non-finite input is refused, and the old value survives', () => {
    const editor = editorAt(1.5);
    for (const bad of [0, -1, 0.05, 5.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = editor.setZoom(bad);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.code).toBe('invalidArgs');
    }
    expect(editor.getZoom()).toBe(1.5); // never silently clamped to a bound
    editor.destroy();
  });

  test('the snapshot reports the same number as getZoom', () => {
    const editor = editorAt();
    editor.setZoom(0.75);
    expect(editor.snapshot().zoom).toBe(0.75);
    expect(editor.getZoom()).toBe(0.75);
    editor.destroy();
  });
});

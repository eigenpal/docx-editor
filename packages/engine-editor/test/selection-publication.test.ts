// Guards for fixes that shipped unfalsifiable (round-6 review).
//
// Round-6 mutation-tested every fix of the previous round one at a time and found six
// of seven had NO coverage: reverting them left the whole 1,875-test suite and all 48
// e2e specs byte-identical. Five of those "verified to fail before the fix" claims
// were therefore true only at the moment they were written — nothing pinned the
// behavior afterwards, so the next round had no way to tell whether it survived.
//
// This file closes the two headless ones and adds the guard for `exec({setSelection})`
// publishing, which round 6 found broken in the same pass.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createEditor, createEditorDriver } from '../src/index.ts';
import type { EditorHost } from '@docx-editor.dev/core-contract/editor';
import { IDENTITY_HOST_METRICS } from '../src/coordinate-mapper.ts';
import { createEditableParagraphFixture } from '../browser/fixtures.ts';

function mountEditor() {
  const body = document.createElement('div');
  const scroll = document.createElement('div');
  scroll.getBoundingClientRect = () =>
    ({ x: 0, y: 0, width: 640, height: 480, top: 0, left: 0, right: 640, bottom: 480, toJSON: () => ({}) }) as DOMRect;
  document.body.append(scroll);
  scroll.append(body);
  const host: EditorHost = {
    getBodyHostEl: () => body,
    getHfHostEl: () => null,
    getPagesContainer: () => null,
    getScrollContainer: () => scroll,
    getInteractionHostMetrics: () => IDENTITY_HOST_METRICS,
    scheduleFrame: (cb) => {
      cb();
      return () => {};
    },
  };
  const editor = createEditor({ host, document: createEditableParagraphFixture() });
  return { editor, driver: createEditorDriver(editor), body, scroll };
}

describe('selectionChange is emitted', () => {
  test('placing a caret emits selectionChange', () => {
    // The headline fix of round 5, and it had zero coverage. `selectionChange` had four
    // subscribers and zero emitters; its absence is why `relayout()` and zoom left the
    // caret un-painted. The only two tests mentioning the event name are source-text
    // greps against the adapters' SUBSCRIBE side and pass regardless.
    const { editor, driver, scroll } = mountEditor();
    let emissions = 0;
    const off = editor.on('selectionChange', () => {
      emissions += 1;
    });

    expect(driver.authorizeCaret(0, 2).ok).toBe(true);
    expect(emissions).toBeGreaterThan(0);

    off();
    editor.destroy();
    scroll.remove();
  });

  test('a relayout re-emits selectionChange so an adapter repaints the caret', () => {
    // The exact sequence that broke: `layoutInput` seeds `caret: null` and fires
    // `display`, so an adapter repaints with no caret; the overlay is then restored but
    // previously without any event, leaving the caret gone until the next click.
    const { editor, driver, scroll } = mountEditor();
    expect(driver.authorizeCaret(0, 2).ok).toBe(true);

    let emissions = 0;
    const off = editor.on('selectionChange', () => {
      emissions += 1;
    });
    editor.relayout({ sync: true });

    expect(emissions).toBeGreaterThan(0);
    // And the caret must genuinely survive it.
    expect(editor.getInteractionFrame().caret).not.toBeNull();

    off();
    editor.destroy();
    scroll.remove();
  });

  test('the emitted snapshot is the editor snapshot, not a placeholder', () => {
    const { editor, driver, scroll } = mountEditor();
    let received: unknown = null;
    const off = editor.on('selectionChange', (snapshot) => {
      received = snapshot;
    });
    expect(driver.authorizeCaret(0, 1).ok).toBe(true);
    expect(received).not.toBeNull();
    // Fields a host would actually read to drive chrome.
    expect(received).toHaveProperty('editable');
    expect(received).toHaveProperty('page');
    off();
    editor.destroy();
    scroll.remove();
  });
});

describe('exec setSelection publishes the frame it moved', () => {
  test('the published frame follows exec, without an intervening focus()', () => {
    // Round 6: this moved the real insertion point and returned ok while publishing
    // nothing, so the painted caret stayed put and the next keystroke edited text the
    // caller never pointed at ("primera linea" -> "pZra linea"). The pre-existing test
    // masked it by calling `editor.focus()` in between — the operation that repairs the
    // frame — and asserting only on the accessibility observation.
    //
    // No `focus()` here, deliberately.
    const { editor, driver, scroll } = mountEditor();
    expect(driver.authorizeCaret(0, 1).ok).toBe(true);
    const before = editor.getInteractionFrame().selection!.head;
    if (before.kind !== 'text') throw new Error('expected a text head');

    const target = { ...before, graphemeOffset: 4 };
    const result = editor.exec({ type: 'setSelection', range: { from: target, to: target } } as never);
    expect(result.ok).toBe(true);

    const after = editor.getInteractionFrame().selection!.head;
    if (after.kind !== 'text') throw new Error('expected a text head');
    expect(after.graphemeOffset).toBe(4);
    // The caret geometry must move with it, not lag at the old offset.
    expect(editor.getInteractionFrame().caret).not.toBeNull();

    editor.destroy();
    scroll.remove();
  });
});

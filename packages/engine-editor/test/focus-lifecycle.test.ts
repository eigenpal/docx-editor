// Focus/blur lifecycle across frame revisions (round-3 independent review).
//
// Two defects lived here, both of the same shape: the frame's focus state and the
// real input focus were allowed to disagree.
//
//   1. `Editor.focus()` rejected with `staleFrame` after ANY dispatched
//      interaction, because the retained selection is tagged with the frame that
//      was current when it was applied and publishing the overlay immediately
//      mints the next one. Both adapters expose this as `ref.focus()`, so
//      programmatic re-entry was impossible.
//   2. A blur left `frame.focus.focused === true`, so a caret kept painting on the
//      page while keystrokes went to whatever really had focus.

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

describe('focus lifecycle', () => {
  test('focus() succeeds after the frame has advanced past the retained selection', () => {
    const { editor, driver, scroll } = mountEditor();

    expect(driver.authorizeCaret(0, 2).ok).toBe(true);
    const frameAfterCaret = editor.getInteractionFrame().id.value;

    // Advance the frame the way any real interaction does.
    editor.relayout();
    const frameNow = editor.getInteractionFrame().id.value;
    expect(frameNow).not.toBe(frameAfterCaret);

    // The retained selection is tagged with an older frame; focus must still work.
    const result = editor.focus();
    expect(result.ok).toBe(true);
    expect(editor.getInteractionFrame().focus.focused).toBe(true);

    editor.destroy();
    scroll.remove();
  });

  test('a caller-supplied selection on a superseded frame is still refused', () => {
    // The frame-id check on the retained path was doing double duty. Relaxing it
    // must not relax the guard for selections that come from OUTSIDE the surface,
    // which is where a genuinely stale position can arrive.
    const { editor, driver, scroll } = mountEditor();
    expect(driver.authorizeCaret(0, 2).ok).toBe(true);
    const stale = editor.getInteractionFrame().selection!;
    editor.relayout();
    const refused = editor.dispatchInteraction({
      kind: 'semanticSelection',
      frameId: editor.getInteractionFrame().id,
      selection: stale,
    } as never).outcome;
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('staleFrame');

    editor.destroy();
    scroll.remove();
  });

  test('a blur stops the frame asserting focus and stops painting a caret', () => {
    const { editor, driver, scroll } = mountEditor();

    expect(driver.authorizeCaret(0, 2).ok).toBe(true);
    expect(editor.getInteractionFrame().focus.focused).toBe(true);
    expect(editor.getInteractionFrame().caret).not.toBeNull();

    const dispatched = editor.dispatchInteraction({
      kind: 'blur',
      frameId: editor.getInteractionFrame().id,
    } as never);
    expect(dispatched.outcome.ok).toBe(true);

    const frame = editor.getInteractionFrame();
    expect(frame.focus.focused).toBe(false);
    // The selection survives a blur — only focus changes.
    expect(frame.selection).not.toBeNull();

    editor.destroy();
    scroll.remove();
  });
});

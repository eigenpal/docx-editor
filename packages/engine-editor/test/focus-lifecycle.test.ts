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
import { createEditorDriver } from '../src/index.ts';
import { createTestEditor as createEditor } from './create-test-editor.ts';
import type { EditorHost } from '@docx-editor.dev/core-contract/contracts/editor';
import { IDENTITY_HOST_METRICS } from '../src/coordinate-mapper.ts';
import { createEditableParagraphFixture } from '../browser/fixtures.ts';

function mountEditor() {
  const body = document.createElement('div');
  const scroll = document.createElement('div');
  scroll.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      width: 640,
      height: 480,
      top: 0,
      left: 0,
      right: 640,
      bottom: 480,
      toJSON: () => ({}),
    }) as DOMRect;
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

  test('focus() after a committed edit still accepts keystrokes', () => {
    // Round-4 review: `focus()` clears input authorization at the top and only
    // restored it on the sync and retained-selection branches. A commit nulls the
    // retained selection, so after any typed edit `focus()` returned ok: true and
    // left input unauthorized — every subsequent keystroke silently dropped, with
    // the call reporting success.
    const { editor, driver, body, scroll } = mountEditor();
    expect(driver.authorizeCaret(0, 2).ok).toBe(true);
    const editable = body.querySelector('[contenteditable="true"]') as HTMLElement;
    const type = (data: string): void => {
      editable.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data,
          bubbles: true,
          cancelable: true,
        })
      );
    };

    type('A');
    const afterFirst = driver.accessibilityObservation().entries[0]?.text ?? '';
    expect(afterFirst).toContain('A');

    // Re-focus programmatically, exactly as an adapter's `ref.focus()` would.
    const refocus = editor.focus();
    expect(refocus.ok).toBe(true);

    // And the editor must still be able to take input.
    type('B');
    const afterSecond = driver.accessibilityObservation().entries[0]?.text ?? '';
    expect(afterSecond).toContain('B');
    expect(afterSecond.length).toBe(afterFirst.length + 1);

    editor.destroy();
    scroll.remove();
  });

  test('focus() accepts keystrokes after load() remounts the surface', () => {
    // Round-5 review: `load()` remounts the surface, discarding its retained semantic
    // selection, so `focus()` returned ok with `focused: true` and a painted caret
    // while every keystroke was dropped. The per-surface `semanticSelectionEverApplied`
    // flag from the previous round moved the hole here instead of closing it.
    const { editor, driver, body, scroll } = mountEditor();
    expect(driver.authorizeCaret(0, 2).ok).toBe(true);

    // Round-trip the document, exactly as a host "reopen" would.
    const reopened = editor.snapshot();
    expect(reopened).toBeDefined();
    editor.load(createEditableParagraphFixture());

    const refocus = editor.focus();
    expect(refocus.ok).toBe(true);

    const editable = body.querySelector('[contenteditable="true"]') as HTMLElement;
    const before = driver.accessibilityObservation().entries[0]?.text ?? '';
    editable.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'K',
        bubbles: true,
        cancelable: true,
      })
    );
    const after = driver.accessibilityObservation().entries[0]?.text ?? '';
    expect(after).not.toBe(before);
    expect(after).toContain('K');

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

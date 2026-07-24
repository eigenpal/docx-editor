import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createEditor, createEditorDriver } from '../src/index.ts';
import type { EditorHost } from '@docx-editor.dev/core-contract/editor';
import { IDENTITY_HOST_METRICS } from '../src/coordinate-mapper.ts';
import { frameMembersCoherent } from '../src/interaction-frame.ts';
import { createEditableParagraphFixture } from '../browser/fixtures.ts';

function hostWithBody(body: HTMLElement, scroll: HTMLElement): EditorHost {
  return {
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
}

describe('layout overlay reconciliation (task 4.8)', () => {
  test('relayout republishes PM selection/focus/caret overlay on the new coherent frame', () => {
    const body = document.createElement('div');
    const scroll = document.createElement('div');
    scroll.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 640, height: 480, top: 0, left: 0, right: 640, bottom: 480, toJSON: () => ({}) }) as DOMRect;
    document.body.append(scroll);
    scroll.append(body);

    const editor = createEditor({ host: hostWithBody(body, scroll), document: createEditableParagraphFixture() });
    const driver = createEditorDriver(editor);
    const layoutFrameBefore = editor.getInteractionFrame().id;

    const auth = driver.authorizeCaret(0, 0);
    expect(auth.ok).toBe(true);
    expect(driver.inputHostObservation()?.placementReason).toBe('applied');
    expect(driver.caretClientRect()).not.toBeNull();

    editor.relayout();
    const frame = editor.getInteractionFrame();
    expect(frame.id.value).not.toBe(layoutFrameBefore.value);
    expect(frameMembersCoherent(frame)).toBe(true);
    expect(frame.caret).not.toBeNull();
    expect(frame.focus.focused).toBe(true);
    expect(frame.selection).not.toBeNull();
    expect(frame.revisions.modelRevision).toBe(editor.getDocumentHandle().revision);

    expect(driver.inputHostObservation()?.placementReason).toBe('applied');
    const caret = driver.caretClientRect();
    const hostRect = driver.inputHostObservation()?.clientRect;
    expect(caret).not.toBeNull();
    if (caret && hostRect) {
      expect(Math.abs(hostRect.x - caret.x)).toBeLessThan(3);
      expect(Math.abs(hostRect.y - caret.y)).toBeLessThan(3);
    }

    editor.destroy();
    scroll.remove();
  });

  test('model commit relayout keeps applied placement aligned with live caret', () => {
    const body = document.createElement('div');
    const scroll = document.createElement('div');
    scroll.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 640, height: 480, top: 0, left: 0, right: 640, bottom: 480, toJSON: () => ({}) }) as DOMRect;
    document.body.append(scroll);
    scroll.append(body);

    const editor = createEditor({ host: hostWithBody(body, scroll), document: createEditableParagraphFixture() });
    const driver = createEditorDriver(editor);
    const endOffset = driver
      .accessibilityObservation()
      .entries.filter((e) => e.role === 'editableParagraph')[0]!.text.length;

    expect(driver.authorizeCaret(0, endOffset).ok).toBe(true);
    const editable = body.querySelector('[contenteditable="true"]') as HTMLElement;
    editable.dispatchEvent(
      new InputEvent('beforeinput', { inputType: 'insertText', data: 'z', bubbles: true, cancelable: true }),
    );

    expect(driver.inputHostObservation()?.placementReason).toBe('applied');
    expect(driver.accessibilityObservation().entries[0]?.text).toContain('z');
    expect(frameMembersCoherent(editor.getInteractionFrame())).toBe(true);

    editor.destroy();
    scroll.remove();
  });
});

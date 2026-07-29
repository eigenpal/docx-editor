import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createEditorDriver } from '../src/index.ts';
import { createTestEditor as createEditor } from './create-test-editor.ts';
import type { EditorHost } from '@docx-editor.dev/core-contract/contracts/editor';
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
  test('input-host and public caret placement ignore conflicting rendered geometry', () => {
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
    const conflictingRect = { x: 999, y: 888, width: 7, height: 6 };
    const host: EditorHost = {
      ...hostWithBody(body, scroll),
      getRenderedTextGeometry: () => ({
        caretRect: () => conflictingRect,
        selectionRects: () => [],
        targetAtPoint: () => null,
      }),
    };
    const editor = createEditor({ host, document: createEditableParagraphFixture() });
    const driver = createEditorDriver(editor);

    expect(driver.authorizeCaret(0, 2).ok).toBe(true);
    const frameCaret = editor.getInteractionFrame().caret;
    expect(frameCaret).not.toBeNull();
    expect(driver.caretClientRect()).toEqual(frameCaret?.rect ?? null);
    expect(driver.caretClientRect()).not.toEqual(conflictingRect);
    expect(driver.inputHostObservation()?.clientRect).toMatchObject({
      x: frameCaret!.rect.x,
      y: frameCaret!.rect.y,
    });

    editor.destroy();
    scroll.remove();
  });

  test('relayout republishes PM selection/focus/caret overlay on the new coherent frame', () => {
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

    const editor = createEditor({
      host: hostWithBody(body, scroll),
      document: createEditableParagraphFixture(),
    });
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

    const editor = createEditor({
      host: hostWithBody(body, scroll),
      document: createEditableParagraphFixture(),
    });
    const driver = createEditorDriver(editor);
    const endOffset = driver
      .accessibilityObservation()
      .entries.filter((e) => e.role === 'editableParagraph')[0]!.text.length;

    expect(driver.authorizeCaret(0, endOffset).ok).toBe(true);
    const editable = body.querySelector('[contenteditable="true"]') as HTMLElement;
    editable.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'z',
        bubbles: true,
        cancelable: true,
      })
    );

    expect(driver.inputHostObservation()?.placementReason).toBe('applied');
    expect(driver.accessibilityObservation().entries[0]?.text).toContain('z');
    expect(frameMembersCoherent(editor.getInteractionFrame())).toBe(true);

    editor.destroy();
    scroll.remove();
  });

  test('typing at an INTERIOR offset keeps the caret painted and geometry keys alive', () => {
    // The test above types at the paragraph END, which is the one offset where
    // `caretAffinity` returns 'downstream' and therefore agrees with the constant
    // affinity the edit surface reports. That is why it stayed green while the
    // primary editing loop was broken everywhere else: at any interior offset the
    // reconciled selection was published 'downstream', the only caret stop there is
    // 'upstream', and the exact-affinity lookup returned null — so `frame.caret` was
    // null, no caret painted, and Home/End/PageUp/PageDown/ArrowUp/ArrowDown were
    // all refused with `invalidTarget`.
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

    const editor = createEditor({
      host: hostWithBody(body, scroll),
      document: createEditableParagraphFixture(),
    });
    const driver = createEditorDriver(editor);
    const text = driver
      .accessibilityObservation()
      .entries.filter((e) => e.role === 'editableParagraph')[0]!.text;
    const interior = 2;
    expect(text.length).toBeGreaterThan(interior + 2);

    expect(driver.authorizeCaret(0, interior).ok).toBe(true);
    const editable = body.querySelector('[contenteditable="true"]') as HTMLElement;
    editable.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'z',
        bubbles: true,
        cancelable: true,
      })
    );

    const frame = editor.getInteractionFrame();
    expect(frame.selection).not.toBeNull();
    expect(frame.focus.focused).toBe(true);
    // The published head must carry the affinity the caret-stop index publishes.
    const head = frame.selection!.head;
    expect(head.kind).toBe('text');
    if (head.kind === 'text') {
      expect(head.graphemeOffset).toBe(interior + 1);
      expect(head.affinity).toBe('upstream');
    }
    // And the caret must actually be paintable.
    expect(frame.caret).not.toBeNull();
    expect(driver.caretClientRect()).not.toBeNull();

    // Geometry keys must still be answerable rather than refused for want of a
    // line-resolved caret.
    for (const key of ['Home', 'End', 'ArrowUp', 'ArrowDown']) {
      const result = editor.dispatchInteraction({
        kind: 'geometryKeyboard',
        frameId: editor.getInteractionFrame().id,
        key,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      });
      // A single-line fixture legitimately has nowhere to go vertically; what must
      // NOT happen is a refusal caused by missing caret geometry.
      if (!result.ok) {
        expect(result.reason ?? '').not.toContain('caret');
      }
    }

    editor.destroy();
    scroll.remove();
  });
});

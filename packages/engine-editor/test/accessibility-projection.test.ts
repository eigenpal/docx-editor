import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createEditor } from '../src/create-editor.ts';
import type { EditorHost } from '@docx-editor.dev/core-contract/editor';
import { createEmptyModel, writeDocx } from '@docx-editor.dev/engine-core';
import { PAINTED_PAGES_ASSISTIVE_MARKER } from '@docx-editor.dev/engine-binding';

function hostWith(body: HTMLElement, pages: HTMLElement, scroll: HTMLElement): EditorHost {
  return {
    getBodyHostEl: () => body,
    getHfHostEl: () => null,
    getPagesContainer: () => pages,
    getScrollContainer: () => scroll,
    scheduleFrame: (cb) => {
      cb();
      return () => {};
    },
  };
}

describe('editor accessibility projection integration', () => {
  test('createEditor hides painted pages only while semantic projection is attached', () => {
    const pages = document.createElement('div');
    const body = document.createElement('div');
    const scroll = document.createElement('div');
    scroll.append(pages, body);
    document.body.append(scroll);

    const editor = createEditor({ host: hostWith(body, pages, scroll), document: writeDocx(createEmptyModel()), accessibleName: 'Etiqueta' });
    editor.relayout();
    expect(pages.getAttribute('aria-hidden')).toBe('true');
    expect(body.querySelector('[data-docx-input-host-mount]')?.hasAttribute('role')).toBe(false);

    const obs = editor.getAccessibilityObservation();
    expect(obs.owner).toBe('proseMirrorInputHost');
    expect(obs.paintedPagesAssistiveRole).toBe('presentation');

    editor.destroy();
    expect(pages.hasAttribute('aria-hidden')).toBe(false);
    scroll.remove();
  });

  test('without body host observation owner is none and painted pages stay visible to assistive tech', () => {
    const pages = document.createElement('div');
    const scroll = document.createElement('div');
    scroll.append(pages);
    document.body.append(scroll);

    const editor = createEditor({
      host: { ...hostWith(document.createElement('div'), pages, scroll), getBodyHostEl: () => null },
      document: writeDocx(createEmptyModel()),
    });
    editor.relayout();
    expect(pages.hasAttribute('aria-hidden')).toBe(false);
    const obs = editor.getAccessibilityObservation();
    expect(obs.owner).toBe('none');
    expect(obs.paintedPagesAssistiveRole).toBeNull();
    editor.destroy();
    scroll.remove();
  });

  test('pages container swap clears old assistive attrs and marks new container once', () => {
    const pagesA = document.createElement('div');
    const pagesB = document.createElement('div');
    const body = document.createElement('div');
    const scroll = document.createElement('div');
    scroll.append(pagesA, body);
    document.body.append(scroll);

    let pagesRef: HTMLElement | null = pagesA;
    const host: EditorHost = {
      getBodyHostEl: () => body,
      getHfHostEl: () => null,
      getPagesContainer: () => pagesRef,
      getScrollContainer: () => scroll,
      scheduleFrame: (cb) => {
        cb();
        return () => {};
      },
    };

    const editor = createEditor({ host, document: writeDocx(createEmptyModel()) });
    editor.relayout();
    expect(pagesA.getAttribute(PAINTED_PAGES_ASSISTIVE_MARKER)).toBe('presentation-only');
    expect(pagesB.hasAttribute(PAINTED_PAGES_ASSISTIVE_MARKER)).toBe(false);

    pagesRef = pagesB;
    scroll.append(pagesB);
    editor.relayout();
    expect(pagesA.hasAttribute('aria-hidden')).toBe(false);
    expect(pagesB.getAttribute(PAINTED_PAGES_ASSISTIVE_MARKER)).toBe('presentation-only');

    editor.destroy();
    expect(pagesB.hasAttribute('aria-hidden')).toBe(false);
    scroll.remove();
  });
});

// VIEWING IS FOR READING.
//
// A press, a browser selection or a caret key used to move the model selection in viewing,
// and the toolbar then reported the formatting of text nobody could edit. Each lane is pinned
// here against its editing control, so a lock that also froze editing fails as loudly as a
// lock that let viewing through. Programmatic moves (find, outline, a review card) still land.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import type { SurfaceEditingMode } from '../paginated-surface-contract.ts';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

async function withSurface(
  mode: SurfaceEditingMode,
  run: (surface: PaginatedSurface, container: HTMLElement) => Promise<void> | void
): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, docx(p('alpha beta') + p('gamma delta')), {
    scale: 1,
  });
  if (!opened.ok) throw new Error(opened.reason);
  try {
    const ids = opened.surface.session.paragraphIds();
    // Mid-way into the SECOND paragraph, so every lane under test has somewhere to move.
    const at = { paragraphId: ids[1]!, offset: 3 };
    opened.surface.setSelection({ anchor: at, head: at });
    opened.surface.setEditingMode(mode);
    await run(opened.surface, container);
  } finally {
    opened.surface.destroy();
    container.remove();
    document.getSelection()?.removeAllRanges();
  }
}

function pages(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('.docx-pages')!;
}

function key(container: HTMLElement, init: KeyboardEventInit): void {
  pages(container).dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  );
}

/** The browser's own selection lands in the first paragraph, as a drag or a tap would. */
async function nativeSelectFirstParagraph(container: HTMLElement, surface: PaginatedSurface) {
  const first = surface.session.paragraphIds()[0]!;
  const span = [
    ...pages(container).querySelectorAll<HTMLElement>('[data-paragraph-id][data-start]'),
  ].find((node) => node.dataset.paragraphId === first)!;
  // Past the mirror's own echo guard, which clears on a microtask.
  await Promise.resolve();
  pages(container).dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'touch' })
  );
  const text = span.firstChild!;
  document.getSelection()!.setBaseAndExtent(text, 0, text, 5);
  document.dispatchEvent(new Event('selectionchange'));
}

describe('viewing places no caret and makes no selection', () => {
  test('the surface container carries the viewing class only while viewing', async () => {
    await withSurface('view', (_surface, container) => {
      expect(container.classList.contains('docx-paginated-surface--viewing')).toBe(true);
    });
    await withSurface('edit', (_surface, container) => {
      expect(container.classList.contains('docx-paginated-surface--viewing')).toBe(false);
    });
  });

  for (const [name, init] of [
    ['ArrowLeft', { key: 'ArrowLeft' }],
    ['Shift+ArrowRight', { key: 'ArrowRight', shiftKey: true }],
    ['Home', { key: 'Home' }],
    ['Ctrl+End', { key: 'End', ctrlKey: true }],
    ['PageUp', { key: 'PageUp' }],
    ['Ctrl+A', { key: 'a', ctrlKey: true }],
  ] as const) {
    test(`${name} does not move the selection in viewing, and does in editing`, async () => {
      await withSurface('view', (surface, container) => {
        const before = surface.state().selection;
        key(container, init);
        expect(surface.state().selection).toEqual(before);
      });
      await withSurface('edit', (surface, container) => {
        const before = surface.state().selection;
        key(container, init);
        expect(surface.state().selection).not.toEqual(before);
      });
    });
  }

  test('a document opened for viewing keeps the Show/Hide chord and ignores caret keys', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: docx(p('alpha beta') + p('gamma delta')),
      mode: 'view',
    });
    try {
      const before = editor.snapshot().selection;
      key(container, { key: 'ArrowDown' });
      key(container, { key: 'a', ctrlKey: true });
      expect(editor.snapshot().selection).toEqual(before);
      key(container, { key: '8', code: 'Digit8', metaKey: true });
      expect(editor.snapshot().showParagraphMarks).toBe(true);
      expect(container.classList.contains('docx-paginated-surface--viewing')).toBe(true);
    } finally {
      editor.destroy();
      container.remove();
    }
  });

  test('a browser selection is not adopted in viewing, and is in editing', async () => {
    await withSurface('view', async (surface, container) => {
      const before = surface.state().selection;
      await nativeSelectFirstParagraph(container, surface);
      expect(surface.state().selection).toEqual(before);
    });
    await withSurface('edit', async (surface, container) => {
      await nativeSelectFirstParagraph(container, surface);
      const first = surface.session.paragraphIds()[0]!;
      expect(surface.state().selection.head.paragraphId).toBe(first);
    });
  });

  test('a press on the text does not move the selection in viewing, and does in editing', async () => {
    const press = (container: HTMLElement) => {
      // The first paragraph's text; the caret starts in the second.
      const span = pages(container).querySelector<HTMLElement>('[data-paragraph-id][data-start]')!;
      const init = { bubbles: true, cancelable: true, button: 0, pointerId: 1 };
      span.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
      document.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
    };
    await withSurface('view', (surface, container) => {
      const before = surface.state().selection;
      press(container);
      expect(surface.state().selection).toEqual(before);
    });
    await withSurface('edit', (surface, container) => {
      const before = surface.state().selection;
      press(container);
      expect(surface.state().selection).not.toEqual(before);
    });
  });

  test('a native selection start is refused in viewing, and allowed in editing', async () => {
    const start = (container: HTMLElement) => {
      const event = new Event('selectstart', { bubbles: true, cancelable: true });
      pages(container).querySelector('[data-paragraph-id]')!.dispatchEvent(event);
      return event.defaultPrevented;
    };
    await withSurface('view', (_surface, container) => expect(start(container)).toBe(true));
    await withSurface('edit', (_surface, container) => expect(start(container)).toBe(false));
  });

  test('programmatic selection still lands in viewing', async () => {
    await withSurface('view', (surface) => {
      const first = surface.session.paragraphIds()[0]!;
      const at = { paragraphId: first, offset: 2 };
      surface.setSelection({ anchor: at, head: at });
      expect(surface.state().selection.head).toEqual(at);
    });
  });
});

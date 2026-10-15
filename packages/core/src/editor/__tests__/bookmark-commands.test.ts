import { afterEach, describe, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';
import {
  bookmarkDialogInitialName,
  bookmarkDialogNameState,
  bookmarkDialogRows,
} from '../bookmark-dialog-model.ts';
import { commandForSlot, chromeProbeForSlot, chromeSlotIsToggle } from '../toolbar-commands.ts';
import { chromeMenuSlots } from '../chrome-controls.ts';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function mount(body: string, options: { mode?: 'view' } = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body), ...options });
  editors.push(editor);
  return { editor, surface: editor.surface!, container };
}

function select(editor: DocxEditorInstance, index: number, from: number, to = from): void {
  const surface = editor.surface!;
  const paragraphId = surface.session.paragraphIds()[index]!;
  surface.setSelection({
    anchor: { paragraphId, offset: from },
    head: { paragraphId, offset: to },
  });
}

const names = (editor: DocxEditorInstance) =>
  editor.query({ type: 'bookmarks' }).map((bookmark) => bookmark.name);

const SAMPLE =
  `<w:p>${run('Alpha ')}<w:bookmarkStart w:id="1" w:name="Zeta"/>${run('beta')}` +
  `<w:bookmarkEnd w:id="1"/>${run(' gamma')}</w:p>` +
  `<w:p><w:bookmarkStart w:id="2" w:name="_Toc1"/>${run('Delta')}<w:bookmarkEnd w:id="2"/>` +
  `<w:bookmarkStart w:id="3" w:name="alpha"/><w:bookmarkEnd w:id="3"/></w:p>`;

describe('bookmark commands', () => {
  test('the query lists every bookmark in document order, hidden ones flagged', () => {
    const { editor } = mount(SAMPLE);
    expect(editor.query({ type: 'bookmarks' })).toEqual([
      { name: 'Zeta', hidden: false, story: 'body', order: 0, empty: false, atSelection: false },
      { name: '_Toc1', hidden: true, story: 'body', order: 1, empty: false, atSelection: false },
      { name: 'alpha', hidden: false, story: 'body', order: 2, empty: true, atSelection: false },
    ]);
  });

  test('the query flags the bookmarks the selection starts in', () => {
    const { editor } = mount(SAMPLE);
    select(editor, 0, 7);
    expect(editor.query({ type: 'bookmarks' }).map((bookmark) => bookmark.atSelection)).toEqual([
      true,
      false,
      false,
    ]);
    expect(bookmarkDialogInitialName(editor.query({ type: 'bookmarks' }))).toBe('Zeta');
    select(editor, 0, 0);
    expect(bookmarkDialogInitialName(editor.query({ type: 'bookmarks' }))).toBe('');
  });

  test('insert bookmarks the selection as one undo step', () => {
    const { editor } = mount(SAMPLE);
    select(editor, 0, 0, 5);
    expect(editor.can({ type: 'insertBookmark', name: 'Intro' })).toEqual({ ok: true });
    expect(editor.exec({ type: 'insertBookmark', name: 'Intro' })).toEqual({
      ok: true,
      changed: true,
    });
    expect(names(editor)).toEqual(['Intro', 'Zeta', '_Toc1', 'alpha']);
    editor.exec({ type: 'undo' });
    expect(names(editor)).toEqual(['Zeta', '_Toc1', 'alpha']);
    editor.exec({ type: 'redo' });
    expect(names(editor)).toEqual(['Intro', 'Zeta', '_Toc1', 'alpha']);
  });

  test('insert with an existing name in another case moves that bookmark', () => {
    const { editor } = mount(SAMPLE);
    select(editor, 1, 0, 2);
    expect(editor.exec({ type: 'insertBookmark', name: 'ZETA' }).ok).toBe(true);
    expect(names(editor)).toEqual(['ZETA', '_Toc1', 'alpha']);
  });

  test('insert refuses invalid and hidden names', () => {
    const { editor } = mount(SAMPLE);
    for (const name of ['', '1st', 'two words', '_hidden', 'x'.repeat(41)]) {
      expect(editor.can({ type: 'insertBookmark', name })).toMatchObject({ ok: false });
    }
    expect(editor.can({ type: 'insertBookmark', name: '1st' })).toMatchObject({
      code: 'invalidArgs',
    });
  });

  test('delete removes the bookmark and keeps the text', () => {
    const { editor } = mount(SAMPLE);
    const text = editor.surface!.session.bodyText();
    expect(editor.exec({ type: 'deleteBookmark', name: 'zeta' }).ok).toBe(true);
    expect(names(editor)).toEqual(['_Toc1', 'alpha']);
    expect(editor.surface!.session.bodyText()).toBe(text);
    expect(editor.can({ type: 'deleteBookmark', name: 'zeta' })).toMatchObject({
      ok: false,
      code: 'notFound',
    });
  });

  test('go to selects the bookmark range', () => {
    const { editor } = mount(SAMPLE);
    expect(editor.exec({ type: 'goToBookmark', name: 'Zeta' })).toEqual({
      ok: true,
      changed: false,
    });
    const selection = editor.surface!.state().selection;
    expect([selection.anchor.offset, selection.head.offset]).toEqual([6, 10]);
  });

  test('viewing mode refuses writes and still goes to a bookmark', () => {
    const { editor } = mount(SAMPLE, { mode: 'view' });
    expect(editor.can({ type: 'insertBookmark', name: 'Intro' }).ok).toBe(false);
    expect(editor.can({ type: 'deleteBookmark', name: 'Zeta' }).ok).toBe(false);
    expect(editor.exec({ type: 'goToBookmark', name: 'Zeta' }).ok).toBe(true);
  });
});

describe('show bookmarks', () => {
  test('the toggle paints brackets for visible bookmarks and an I-beam at a point', () => {
    const { editor, container } = mount(SAMPLE);
    expect(editor.snapshot().showBookmarks).toBe(false);
    expect(container.querySelectorAll('.docx-bookmark-mark')).toHaveLength(0);
    expect(editor.exec({ type: 'toggleBookmarks' })).toEqual({ ok: true, changed: false });
    expect(editor.snapshot().showBookmarks).toBe(true);
    expect(editor.isActive({ type: 'toggleBookmarks' })).toBe(true);
    const marks = [...container.querySelectorAll<HTMLElement>('.docx-bookmark-mark')];
    expect(marks.map((mark) => mark.className.split('--')[1])).toEqual(['start', 'end', 'point']);
    for (const mark of marks) {
      expect(mark.closest('.docx-bookmark-overlay')).not.toBeNull();
      expect(mark.closest('[contenteditable="true"]')).toBeNull();
      expect(mark.dataset.docxMarker).toBe('');
      expect(Number.parseFloat(mark.style.height)).toBeGreaterThan(0);
    }
    editor.exec({ type: 'toggleBookmarks' });
    expect(container.querySelectorAll('.docx-bookmark-mark')).toHaveLength(0);
  });

  test('marks follow an edit and the document does not change', () => {
    const { editor, container } = mount(SAMPLE);
    const revision = editor.surface!.session.packageRevision();
    editor.exec({ type: 'toggleBookmarks' });
    expect(editor.surface!.session.packageRevision()).toBe(revision);
    expect(editor.snapshot().canUndo).toBe(false);
    select(editor, 0, 0);
    editor.exec({ type: 'insertText', text: 'More ' });
    expect(container.querySelectorAll('.docx-bookmark-mark')).toHaveLength(3);
  });
});

describe('bookmark chrome', () => {
  test('slots map to the dialog probe and the view toggle', () => {
    expect(commandForSlot('review.bookmarks')).toEqual({ type: 'toggleBookmarks' });
    expect(chromeSlotIsToggle('review.bookmarks')).toBe(true);
    expect(chromeProbeForSlot('insert.bookmark')).toEqual({ type: 'toggleBookmarks' });
    expect(chromeMenuSlots()).toContain('insert.bookmark');
    expect(chromeMenuSlots()).toContain('review.bookmarks');
  });

  test('Ctrl+Shift+F5 asks the registered chrome for the dialog', () => {
    const { editor, container } = mount(SAMPLE);
    let requests = 0;
    const off = editor.setBookmarkChrome({ onRequest: () => (requests += 1) });
    const pages = container.querySelector<HTMLElement>('[contenteditable="true"]')!;
    const press = () => {
      const event = new KeyboardEvent('keydown', {
        key: 'F5',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      pages.dispatchEvent(event);
      return event;
    };
    expect(press().defaultPrevented).toBe(true);
    expect(requests).toBe(1);
    off();
    press();
    expect(requests).toBe(1);
  });

  test('the dialog model sorts, filters hidden names and validates the name', () => {
    const { editor } = mount(SAMPLE);
    const list = editor.query({ type: 'bookmarks' });
    const rows = (sortBy: 'name' | 'location', showHidden: boolean) =>
      bookmarkDialogRows(list, { sortBy, showHidden }).map((row) => row.name);
    expect(rows('name', false)).toEqual(['alpha', 'Zeta']);
    expect(rows('location', false)).toEqual(['Zeta', 'alpha']);
    expect(rows('location', true)).toEqual(['Zeta', '_Toc1', 'alpha']);
    expect(bookmarkDialogNameState(list, 'zeta', true)).toMatchObject({
      problem: null,
      canAdd: true,
      canDelete: true,
      canGoTo: true,
    });
    expect(bookmarkDialogNameState(list, '_x', true)).toMatchObject({
      problem: 'invalidStart',
      canAdd: false,
    });
    expect(bookmarkDialogNameState(list, 'zeta', false)).toMatchObject({
      canAdd: false,
      canDelete: false,
      canGoTo: true,
    });
  });
});

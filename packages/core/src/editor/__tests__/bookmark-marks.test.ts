// Show bookmarks customization (`setBookmarkMarks`), header and footer marks, the
// `openBookmarkDialog` command, and the duplicates a concurrent merge can leave.

import { afterEach, describe, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function mount(body: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body) });
  editors.push(editor);
  return { editor, container };
}

const SAMPLE =
  `<w:p>${run('Alpha ')}<w:bookmarkStart w:id="1" w:name="Zeta"/>${run('beta')}` +
  `<w:bookmarkEnd w:id="1"/>${run(' gamma')}</w:p>` +
  `<w:p><w:bookmarkStart w:id="2" w:name="_Toc1"/>${run('Delta')}<w:bookmarkEnd w:id="2"/>` +
  `<w:bookmarkStart w:id="3" w:name="alpha"/><w:bookmarkEnd w:id="3"/></w:p>`;

const marksOf = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>('.docx-bookmark-mark'),
];
const describeMark = (mark: HTMLElement) =>
  `${mark.dataset.bookmarkName}:${mark.dataset.bookmarkEdge}:${mark.dataset.bookmarkHidden}`;

describe('bookmark mark options', () => {
  test('each mark names its bookmark, edge, visibility and story', () => {
    const { editor, container } = mount(SAMPLE);
    editor.exec({ type: 'toggleBookmarks' });
    expect(marksOf(container).map(describeMark)).toEqual([
      'Zeta:start:false',
      'Zeta:end:false',
      'alpha:point:false',
    ]);
    expect(marksOf(container).every((mark) => mark.dataset.bookmarkStory === 'body')).toBe(true);
  });

  test('include chooses the bookmarks, and disposal restores the default', () => {
    const { editor, container } = mount(SAMPLE);
    editor.exec({ type: 'toggleBookmarks' });
    const off = editor.setBookmarkMarks({ include: 'all' });
    expect(marksOf(container).map(describeMark)).toContain('_Toc1:start:true');
    const offFilter = editor.setBookmarkMarks({
      include: (bookmark) => bookmark.name === 'alpha',
    });
    expect(marksOf(container).map(describeMark)).toEqual(['alpha:point:false']);
    offFilter();
    off();
    expect(marksOf(container)).toHaveLength(3);
  });

  test('decorate adjusts or replaces a mark, and the editor still places it', () => {
    const { editor, container } = mount(SAMPLE);
    editor.setBookmarkMarks({
      decorate(element, mark) {
        if (mark.edge === 'point') {
          const replacement = element.ownerDocument.createElement('span');
          replacement.className = 'my-point';
          return replacement;
        }
        element.title = mark.name;
        element.classList.add('my-mark');
      },
    });
    editor.exec({ type: 'toggleBookmarks' });
    const point = container.querySelector<HTMLElement>('.my-point')!;
    expect(point.dataset.bookmarkEdge).toBe('point');
    expect(point.style.position).toBe('absolute');
    expect(Number.parseFloat(point.style.height)).toBeGreaterThan(0);
    expect(point.closest('[contenteditable="true"]')).toBeNull();
    const titled = [...container.querySelectorAll<HTMLElement>('.my-mark')];
    expect(titled.map((mark) => mark.title)).toEqual(['Zeta', 'Zeta']);
  });

  test('print keeps the marks for the browser print only on request', () => {
    const { editor, container } = mount(SAMPLE);
    editor.exec({ type: 'toggleBookmarks' });
    const sheet = container.querySelector('.docx-bookmark-overlay')!;
    expect(sheet.classList.contains('docx-bookmark-overlay--print')).toBe(false);
    const off = editor.setBookmarkMarks({ print: true });
    expect(sheet.classList.contains('docx-bookmark-overlay--print')).toBe(true);
    off();
    expect(sheet.classList.contains('docx-bookmark-overlay--print')).toBe(false);
  });

  test('a header bookmark is marked on every page that shows the header', () => {
    const { editor, container } = mount(
      `<w:p>${run('One')}</w:p><w:p><w:r><w:br w:type="page"/></w:r>${run('Two')}</w:p>`
    );
    expect(editor.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
    expect(editor.exec({ type: 'insertText', text: 'Head' }).ok).toBe(true);
    const surface = editor.surface!;
    const head = surface.state().selection.head;
    surface.setSelection({ anchor: { ...head, offset: 0 }, head });
    expect(editor.exec({ type: 'insertBookmark', name: 'Top' }).ok).toBe(true);
    editor.exec({ type: 'toggleBookmarks' });
    const marks = marksOf(container).filter((mark) => mark.dataset.bookmarkName === 'Top');
    expect(marks.every((mark) => mark.dataset.bookmarkStory === 'headerFooter')).toBe(true);
    expect(editor.surface!.state().pageCount).toBe(2);
    expect(marks.map((mark) => mark.dataset.bookmarkEdge)).toEqual([
      'start',
      'start',
      'end',
      'end',
    ]);
    // One pair per page: the same place on the line, on two different pages.
    const starts = marks.filter((mark) => mark.dataset.bookmarkEdge === 'start');
    expect(starts[0]!.style.left).toBe(starts[1]!.style.left);
    expect(Number.parseFloat(starts[1]!.style.top)).toBeGreaterThan(
      Number.parseFloat(starts[0]!.style.top)
    );
  });
});

describe('right-to-left marks', () => {
  test('brackets open toward the bookmarked text in a right-to-left paragraph', () => {
    const rtl = (text: string) =>
      `<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
    const { editor, container } = mount(
      `<w:p><w:pPr><w:bidi/></w:pPr>${rtl('שלום ')}<w:bookmarkStart w:id="1" w:name="Rtl"/>` +
        `${rtl('עולם')}<w:bookmarkEnd w:id="1"/>${rtl(' טוב')}</w:p>` +
        `<w:p>${run('Left ')}<w:bookmarkStart w:id="2" w:name="Ltr"/>${run('to right')}` +
        `<w:bookmarkEnd w:id="2"/></w:p>`
    );
    editor.exec({ type: 'toggleBookmarks' });
    const mirrored = (name: string) =>
      marksOf(container)
        .filter((mark) => mark.dataset.bookmarkName === name)
        .map((mark) => mark.classList.contains('docx-bookmark-mark--rtl'));
    expect(mirrored('Rtl')).toEqual([true, true]);
    expect(mirrored('Ltr')).toEqual([false, false]);
  });
});

describe('openBookmarkDialog', () => {
  test('opens the registered dialog, and is refused while none is registered', () => {
    const { editor } = mount(SAMPLE);
    expect(editor.can({ type: 'openBookmarkDialog' })).toMatchObject({
      ok: false,
      code: 'unsupported',
    });
    let opened = 0;
    const off = editor.setBookmarkChrome({ onRequest: () => (opened += 1) });
    expect(editor.can({ type: 'openBookmarkDialog' }).ok).toBe(true);
    expect(editor.exec({ type: 'openBookmarkDialog' })).toEqual({ ok: true, changed: false });
    expect(opened).toBe(1);
    off();
    expect(editor.exec({ type: 'openBookmarkDialog' }).ok).toBe(false);
    expect(opened).toBe(1);
  });

  test('works in a read-only document, where Go To still does', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: docx(SAMPLE), mode: 'view' });
    editors.push(editor);
    editor.setBookmarkChrome({ onRequest: () => {} });
    expect(editor.can({ type: 'openBookmarkDialog' }).ok).toBe(true);
  });
});

describe('bookmark copies', () => {
  const COPIES =
    `<w:p><w:bookmarkStart w:id="1" w:name="Same"/>${run('one')}<w:bookmarkEnd w:id="1"/>` +
    `${run(' ')}<w:bookmarkStart w:id="2" w:name="SAME"/>${run('two')}<w:bookmarkEnd w:id="2"/>` +
    `</w:p>`;

  test('one row per name, counting the copies; the first answers', () => {
    const { editor, container } = mount(COPIES);
    expect(editor.query({ type: 'bookmarks' })).toMatchObject([{ name: 'Same', duplicates: 1 }]);
    editor.exec({ type: 'toggleBookmarks' });
    expect(marksOf(container)).toHaveLength(2);
    expect(editor.exec({ type: 'goToBookmark', name: 'same' }).ok).toBe(true);
    const selection = editor.surface!.state().selection;
    expect([selection.anchor.offset, selection.head.offset]).toEqual([0, 3]);
  });

  test('adding the name again at the first keeps it and removes the copy in one step', () => {
    const { editor } = mount(COPIES);
    editor.exec({ type: 'goToBookmark', name: 'Same' });
    expect(editor.exec({ type: 'insertBookmark', name: 'Same' }).ok).toBe(true);
    expect(editor.query({ type: 'bookmarks' })).toMatchObject([{ name: 'Same', duplicates: 0 }]);
    editor.exec({ type: 'undo' });
    expect(editor.query({ type: 'bookmarks' })).toMatchObject([{ name: 'Same', duplicates: 1 }]);
  });
});

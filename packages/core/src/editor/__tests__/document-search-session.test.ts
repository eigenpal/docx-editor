import { afterEach, describe, expect, test } from 'bun:test';
import { docx } from './paginated-surface-fixtures.ts';
import { mountAnchorEditor } from './scroll-to-anchor-fixture.ts';
import {
  createDocumentSearch,
  SEARCH_DEBOUNCE_MS,
  SEARCH_HIGHLIGHT_SET,
} from '../document-search.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function mount() {
  const mounted = mountAnchorEditor(docx(p('Supplier pays Supplier.') + p('The Supplier signs.')));
  cleanups.push(mounted.destroy);
  const marks = () =>
    [
      ...mounted.host.querySelectorAll<HTMLElement>(
        `[data-highlight-set="${SEARCH_HIGHLIGHT_SET}"] .docx-text-highlight`
      ),
    ].map((mark) => ({
      index: Number(mark.dataset.highlightIndex),
      active: mark.classList.contains('docx-text-highlight--active'),
    }));
  return { ...mounted, marks };
}

describe('createDocumentSearch', () => {
  test('returns one session per editor', () => {
    const { editor } = mount();
    expect(createDocumentSearch(editor)).toBe(createDocumentSearch(editor));
  });

  test('find runs now, and navigation moves the shared active match', () => {
    const { editor } = mount();
    const search = createDocumentSearch(editor);
    const seen: number[] = [];
    search.subscribe(() => seen.push(search.getState().activeIndex));
    expect(search.find('Supplier')).toHaveLength(3);
    expect(search.getState()).toMatchObject({ query: 'Supplier', activeIndex: -1 });
    expect(search.next()).toBe(true);
    expect(search.getState().activeIndex).toBe(0);
    expect(search.previous()).toBe(true);
    expect(search.getState().activeIndex).toBe(2);
    expect(search.goTo(9)).toBe(false);
    expect(seen).toEqual([-1, 0, 2]);
  });

  test('setQuery waits for the debounce, then searches', async () => {
    const { editor } = mount();
    const search = createDocumentSearch(editor);
    search.setQuery('Supplier');
    expect(search.getState()).toMatchObject({ query: 'Supplier', isPending: true });
    expect(search.getState().matches).toHaveLength(0);
    await wait(SEARCH_DEBOUNCE_MS + 30);
    expect(search.getState()).toMatchObject({ isPending: false });
    expect(search.getState().matches).toHaveLength(3);
  });

  test('match options apply to the current query', () => {
    const { editor } = mount();
    const search = createDocumentSearch(editor);
    search.find('supplier');
    expect(search.getState().matches).toHaveLength(3);
    search.setMatchCase(true);
    expect(search.getState()).toMatchObject({ matchCase: true });
    expect(search.getState().matches).toHaveLength(0);
  });

  test('results follow document edits under the same query', () => {
    const { editor } = mount();
    const search = createDocumentSearch(editor);
    search.find('Supplier');
    const last = search.getState().matches[2]!;
    const caret = { paragraphId: last.blockId, offset: last.start };
    editor.exec({ type: 'setSelection', range: { anchor: caret, head: caret } });
    editor.exec({ type: 'insertText', text: 'Supplier ' });
    expect(search.getState().matches).toHaveLength(4);
  });

  test('highlights show while a request is held, the widest request winning', () => {
    const { editor, marks } = mount();
    const search = createDocumentSearch(editor);
    search.find('Supplier');
    expect(marks()).toEqual([]);
    const active = search.showHighlights('active');
    search.goTo(1);
    expect(marks().map((mark) => mark.active)).toEqual([true]);
    const all = search.showHighlights('all');
    expect(new Set(marks().map((mark) => mark.index))).toEqual(new Set([0, 1, 2]));
    expect(
      marks()
        .filter((mark) => mark.active)
        .map((mark) => mark.index)
    ).toEqual([1]);
    all();
    expect(marks()).toHaveLength(1);
    active();
    expect(marks()).toEqual([]);
  });

  test('a search nobody shows leaves a host set of the same name alone', () => {
    const { editor, host } = mount();
    const search = createDocumentSearch(editor);
    editor.setHighlights(SEARCH_HIGHLIGHT_SET, editor.findMatches('signs'));
    search.find('Supplier');
    search.clear();
    expect(host.querySelectorAll('.docx-text-highlight')).toHaveLength(1);
  });

  test('clear empties the query and removes shown highlights', () => {
    const { editor, marks } = mount();
    const search = createDocumentSearch(editor);
    search.showHighlights('all');
    search.find('Supplier');
    expect(marks()).toHaveLength(3);
    search.clear();
    expect(search.getState()).toMatchObject({ query: '', activeIndex: -1 });
    expect(marks()).toEqual([]);
  });

  test('navigation keeps focus where it is unless asked to move it', () => {
    const { editor } = mount();
    const search = createDocumentSearch(editor);
    const input = document.createElement('input');
    document.body.append(input);
    cleanups.push(() => input.remove());
    input.focus();
    search.find('Supplier');
    expect(search.next()).toBe(true);
    expect(document.activeElement).toBe(input);
    let focused = 0;
    const focus = editor.focus.bind(editor);
    editor.focus = (...args) => {
      focused += 1;
      return focus(...args);
    };
    expect(search.next({ focus: true })).toBe(true);
    expect(focused).toBe(1);
  });

  test('the active match stays on its occurrence when an edit adds an earlier match', () => {
    const { editor } = mount();
    const search = createDocumentSearch(editor);
    search.find('Supplier');
    search.goTo(2);
    const active = search.getState().matches[2]!;
    // Add a match in the first paragraph: the old index 2 now names a different occurrence.
    const start = { paragraphId: search.getState().matches[0]!.blockId, offset: 0 };
    editor.exec({ type: 'setSelection', range: { anchor: start, head: start } });
    editor.exec({ type: 'insertText', text: 'Supplier ' });
    const state = search.getState();
    expect(state.matches).toHaveLength(4);
    expect(state.activeIndex).toBe(3);
    expect(state.matches[3]!.blockId).toBe(active.blockId);
  });
});

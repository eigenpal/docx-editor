// Text highlights through the React adapter: Find marks its matches, and `useHighlights`
// owns a host set for as long as its component is mounted.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { useCallback } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import type { Editor, HighlightResult } from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorNavigation } from '../src/editor/navigation/DocxEditorNavigation.tsx';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_HIGHLIGHT_SET,
  useDocumentSearch,
  type UseDocumentSearchOptions,
  type UseDocumentSearchResult,
} from '../src/editor/navigation/useDocumentSearch.ts';
import { HIGHLIGHT_REFRESH_MS, useHighlights } from '../src/editor/useHighlights.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(...paragraphs: string[]): Uint8Array {
  const body = paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('');
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

const SOURCE = docx('Supplier pays Supplier.', 'The Supplier signs.');
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(cleanup);

function marks(container: HTMLElement, set: string) {
  return [
    ...container.querySelectorAll<HTMLElement>(
      `[data-highlight-set="${set}"] .docx-text-highlight`
    ),
  ];
}
const indexes = (elements: readonly HTMLElement[]) =>
  [...new Set(elements.map((element) => Number(element.dataset.highlightIndex)))].sort(
    (a, b) => a - b
  );
const activeIndexes = (elements: readonly HTMLElement[]) =>
  indexes(elements.filter((element) => element.classList.contains('docx-text-highlight--active')));

function mount(children: React.ReactNode, source = SOURCE) {
  let editor: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      onReady={(instance) => {
        editor = instance as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
      {children}
    </DocxEditorRoot>
  );
  return { view, editor: () => editor! };
}

describe('useDocumentSearch highlights', () => {
  let search: UseDocumentSearchResult;
  function Probe(props: { options?: UseDocumentSearchOptions }) {
    search = useDocumentSearch(props.options);
    return null;
  }

  async function runQuery(query: string) {
    act(() => search.setQuery(query));
    await act(async () => wait(SEARCH_DEBOUNCE_MS + 30));
  }

  test('marks every match and moves the active mark with navigation', async () => {
    const { view } = mount(<Probe />);
    await runQuery('Supplier');
    expect(search.matches).toHaveLength(3);
    expect(indexes(marks(view.container, SEARCH_HIGHLIGHT_SET))).toEqual([0, 1, 2]);
    expect(activeIndexes(marks(view.container, SEARCH_HIGHLIGHT_SET))).toEqual([]);

    await act(async () => search.next());
    expect(activeIndexes(marks(view.container, SEARCH_HIGHLIGHT_SET))).toEqual([0]);
    await act(async () => search.previous());
    expect(activeIndexes(marks(view.container, SEARCH_HIGHLIGHT_SET))).toEqual([2]);

    await act(async () => search.clear());
    expect(marks(view.container, SEARCH_HIGHLIGHT_SET)).toHaveLength(0);
  });

  test("'active' marks only the current match and 'none' marks nothing", async () => {
    const { view } = mount(<Probe options={{ highlight: 'active' }} />);
    await runQuery('Supplier');
    expect(marks(view.container, SEARCH_HIGHLIGHT_SET)).toHaveLength(0);
    await act(async () => search.goTo(1));
    // The one mark is range 0 of a one-range set, so read the matched text through the API.
    expect(marks(view.container, SEARCH_HIGHLIGHT_SET).length).toBeGreaterThan(0);
    expect(activeIndexes(marks(view.container, SEARCH_HIGHLIGHT_SET))).toEqual([0]);

    view.rerender(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <Probe options={{ highlight: 'none' }} />
      </DocxEditorRoot>
    );
    await act(async () => wait(0));
    expect(marks(view.container, SEARCH_HIGHLIGHT_SET)).toHaveLength(0);
  });

  test('unmounting the search removes its marks', async () => {
    let show = true;
    function Toggle() {
      return show ? <Probe /> : null;
    }
    const { view } = mount(<Toggle />);
    await runQuery('Supplier');
    expect(marks(view.container, SEARCH_HIGHLIGHT_SET).length).toBeGreaterThan(0);
    show = false;
    view.rerender(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <Toggle />
      </DocxEditorRoot>
    );
    await act(async () => wait(0));
    expect(marks(view.container, SEARCH_HIGHLIGHT_SET)).toHaveLength(0);
  });
});

describe('DocxEditor.Navigation highlights', () => {
  async function typeQuery(container: HTMLElement, query: string) {
    const input = container.querySelector<HTMLInputElement>(
      '#docx-nav-panel-find .docx-nav__search-input'
    )!;
    await act(async () => {
      fireEvent.change(input, { target: { value: query } });
      await wait(SEARCH_DEBOUNCE_MS + 30);
    });
  }

  test('marks matches only while the Find tab is open', async () => {
    const tree = (open: boolean, tab: 'find' | 'headings') => (
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <DocxEditorNavigation open={open} tab={tab} />
      </DocxEditorRoot>
    );
    const view = render(tree(true, 'find'));
    await typeQuery(view.container, 'Supplier');
    expect(indexes(marks(view.container, SEARCH_HIGHLIGHT_SET))).toEqual([0, 1, 2]);

    view.rerender(tree(true, 'headings'));
    await act(async () => wait(0));
    expect(marks(view.container, SEARCH_HIGHLIGHT_SET)).toHaveLength(0);

    view.rerender(tree(true, 'find'));
    await act(async () => wait(0));
    expect(indexes(marks(view.container, SEARCH_HIGHLIGHT_SET))).toEqual([0, 1, 2]);

    view.rerender(tree(false, 'find'));
    await act(async () => wait(0));
    expect(marks(view.container, SEARCH_HIGHLIGHT_SET)).toHaveLength(0);
  });

  test("searchHighlight='none' keeps the document unmarked", async () => {
    const view = render(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <DocxEditorNavigation open tab="find" searchHighlight="none" />
      </DocxEditorRoot>
    );
    await typeQuery(view.container, 'Supplier');
    expect(marks(view.container, SEARCH_HIGHLIGHT_SET)).toHaveLength(0);
  });
});

describe('useHighlights', () => {
  test('applies an array, reports the result, and clears on unmount', async () => {
    let result: HighlightResult | null = null;
    let ranges: readonly import('@docx-editor.dev/core/contracts/editor').HighlightRange[] = [];
    function Marks() {
      result = useHighlights('glossary', ranges, { className: 'term' });
      return null;
    }
    let show = false;
    const tree = () => (
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        {show && <Marks />}
      </DocxEditorRoot>
    );
    let editor: DocxEditorInstance | null = null;
    const view = render(
      <DocxEditorRoot document={SOURCE} onReady={(instance) => (editor = instance as never)}>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    ranges = editor!.findMatches('Supplier');
    show = true;
    view.rerender(tree());
    await act(async () => wait(0));
    expect(result).toEqual({ applied: 3, unavailable: 0 });
    const painted = marks(view.container, 'glossary');
    expect(indexes(painted)).toEqual([0, 1, 2]);
    expect(painted.every((mark) => mark.classList.contains('term'))).toBe(true);

    show = false;
    view.rerender(tree());
    await act(async () => wait(0));
    expect(marks(view.container, 'glossary')).toHaveLength(0);
  });

  test('an inline options literal does not reapply the set every render', async () => {
    const { view, editor } = mount(null);
    const ranges = editor().findMatches('Supplier');
    let calls = 0;
    const setHighlights = editor().setHighlights.bind(editor());
    editor().setHighlights = (...args) => {
      calls += 1;
      return setHighlights(...args);
    };
    function Marks(props: { tick: number }) {
      void props.tick;
      useHighlights('glossary', ranges, { priority: 1 });
      return null;
    }
    const tree = (tick: number) => (
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
        <Marks tick={tick} />
      </DocxEditorRoot>
    );
    view.rerender(tree(1));
    view.rerender(tree(2));
    view.rerender(tree(3));
    await act(async () => wait(0));
    expect(calls).toBe(1);
  });

  test('a function source runs again after document changes', async () => {
    let runs = 0;
    function Marks() {
      const find = useCallback((editor: Editor) => {
        runs += 1;
        return editor.findMatches('Supplier');
      }, []);
      useHighlights('glossary', find);
      return null;
    }
    const { view, editor } = mount(<Marks />);
    await act(async () => wait(0));
    expect(indexes(marks(view.container, 'glossary'))).toEqual([0, 1, 2]);
    const before = runs;

    const first = editor().findMatches('signs')[0]!;
    await act(async () => {
      const caret = { paragraphId: first.blockId, offset: first.start };
      editor().exec({ type: 'setSelection', range: { anchor: caret, head: caret } });
      editor().exec({ type: 'insertText', text: 'Supplier ' });
      await wait(HIGHLIGHT_REFRESH_MS + 50);
    });
    expect(runs).toBeGreaterThan(before);
    expect(indexes(marks(view.container, 'glossary'))).toEqual([0, 1, 2, 3]);
  });

  test('reapplying a set keeps its stacking position', async () => {
    function Marks() {
      const first = useCallback((editor: Editor) => editor.findMatches('Supplier'), []);
      const second = useCallback((editor: Editor) => editor.findMatches('signs'), []);
      useHighlights('first', first);
      useHighlights('second', second);
      return null;
    }
    const { view, editor } = mount(<Marks />);
    await act(async () => wait(0));
    const order = () =>
      [...view.container.querySelectorAll<HTMLElement>('[data-highlight-set]')].map(
        (sheet) => sheet.dataset.highlightSet
      );
    expect(order()).toEqual(['first', 'second']);
    await act(async () => {
      editor().exec({ type: 'insertText', text: 'X' });
      await wait(HIGHLIGHT_REFRESH_MS + 50);
    });
    expect(order()).toEqual(['first', 'second']);
  });
});

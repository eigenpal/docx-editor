/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
// Text highlights through the Vue adapter: Find marks its matches, and `useHighlights`
// owns a host set while its scope is active.

import './dom-setup.ts';

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick, ref, watchEffect, type App, type Ref } from 'vue';
import { strToU8, zipSync } from 'fflate';
import type {
  Editor,
  HighlightHit,
  HighlightRange,
  HighlightResult,
  TextMatch,
} from '@docx-editor.dev/core/contracts/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport';
import { DocxEditorContent } from '../src/editor/DocxEditorContent';
import { DocxEditorNavigation } from '../src/editor/navigation/DocxEditorNavigation';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_HIGHLIGHT_SET,
  useDocumentSearch,
  type DocumentSearchHighlight,
} from '../src/editor/navigation/useDocumentSearch';
import { HIGHLIGHT_REFRESH_MS, useHighlights } from '../src/editor/useHighlights';
import { useHighlightAt } from '../src/editor/useHighlightAt';
import {
  ContextMenu,
  useContextMenuHighlights,
  useContextMenuAnchor,
  type ContextMenuAnchor,
} from '../src/editor/contextmenu';
import { createDocumentSearch } from '@docx-editor.dev/core/editor';

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

async function flush(): Promise<void> {
  await nextTick();
  for (let i = 0; i < 10; i++) await new Promise((r) => queueMicrotask(r));
  await wait(50);
}

const apps: { app: App; container: HTMLElement }[] = [];
afterEach(() => {
  for (const { app, container } of apps.splice(0)) {
    app.unmount();
    container.remove();
  }
});

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

async function mount(children: () => unknown[], viewportChildren: () => unknown[] = () => []) {
  let editor: DocxEditorInstance | null = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        {
          document: SOURCE,
          onReady: (value: Editor) => {
            editor = value as DocxEditorInstance;
          },
        },
        {
          default: () => [
            h(DocxEditorViewport, null, {
              default: () => [h(DocxEditorContent), ...(viewportChildren() as never[])],
            }),
            ...(children() as never[]),
          ],
        }
      ),
  });
  apps.push({ app, container });
  app.mount(container);
  await flush();
  return { container, editor: () => editor! };
}

describe('useDocumentSearch highlights', () => {
  test('marks every match, follows navigation, and clears', async () => {
    let search: ReturnType<typeof useDocumentSearch> | null = null;
    const mode = ref<DocumentSearchHighlight>('all');
    const Probe = defineComponent({
      setup() {
        search = useDocumentSearch(() => ({ highlight: mode.value }));
        return () => null;
      },
    });
    const { container } = await mount(() => [h(Probe)]);
    search!.setQuery('Supplier');
    await wait(SEARCH_DEBOUNCE_MS + 30);
    await flush();
    expect(indexes(marks(container, SEARCH_HIGHLIGHT_SET))).toEqual([0, 1, 2]);

    search!.next();
    await flush();
    expect(activeIndexes(marks(container, SEARCH_HIGHLIGHT_SET))).toEqual([0]);

    mode.value = 'active';
    await flush();
    expect(activeIndexes(marks(container, SEARCH_HIGHLIGHT_SET))).toEqual([0]);
    expect(
      marks(container, SEARCH_HIGHLIGHT_SET).every((mark) => mark.dataset.highlightIndex === '0')
    ).toBe(true);

    mode.value = 'none';
    await flush();
    expect(marks(container, SEARCH_HIGHLIGHT_SET)).toHaveLength(0);

    mode.value = 'all';
    await flush();
    search!.clear();
    await flush();
    expect(marks(container, SEARCH_HIGHLIGHT_SET)).toHaveLength(0);
  });

  test('the navigation pane marks matches only while the Find tab is open', async () => {
    const open = ref(true);
    const tab = ref<'find' | 'headings'>('find');
    const { container } = await mount(() => [
      h(DocxEditorNavigation, { open: open.value, tab: tab.value }),
    ]);
    const input = container.querySelector<HTMLInputElement>(
      '#docx-nav-panel-find .docx-nav__search-input'
    )!;
    input.value = 'Supplier';
    input.dispatchEvent(new Event('input'));
    await wait(SEARCH_DEBOUNCE_MS + 30);
    await flush();
    expect(indexes(marks(container, SEARCH_HIGHLIGHT_SET))).toEqual([0, 1, 2]);

    tab.value = 'headings';
    await flush();
    expect(marks(container, SEARCH_HIGHLIGHT_SET)).toHaveLength(0);

    tab.value = 'find';
    await flush();
    expect(indexes(marks(container, SEARCH_HIGHLIGHT_SET))).toEqual([0, 1, 2]);

    open.value = false;
    await flush();
    expect(marks(container, SEARCH_HIGHLIGHT_SET)).toHaveLength(0);
  });
});

describe('shared search session', () => {
  test('a search started from code shows in the open pane, and the pane drives it back', async () => {
    const { container, editor } = await mount(() => [
      h(DocxEditorNavigation, { open: true, tab: 'find' }),
    ]);
    const search = createDocumentSearch(editor());
    search.find('Supplier');
    await flush();
    const input = container.querySelector<HTMLInputElement>(
      '#docx-nav-panel-find .docx-nav__search-input'
    )!;
    expect(input.value).toBe('Supplier');
    expect(indexes(marks(container, SEARCH_HIGHLIGHT_SET))).toEqual([0, 1, 2]);
    search.goTo(2);
    await flush();
    expect(activeIndexes(marks(container, SEARCH_HIGHLIGHT_SET))).toEqual([2]);
    container
      .querySelector<HTMLButtonElement>('#docx-nav-panel-find button[aria-label="Next result"]')!
      .click();
    await flush();
    expect(search.getState().activeIndex).toBe(0);
  });
});

describe('useHighlights', () => {
  test('applies a ref of ranges, reports the result, and clears with its scope', async () => {
    const ranges: Ref<readonly HighlightRange[]> = ref([]);
    const show = ref(true);
    let result: { value: HighlightResult } | null = null;
    const Marks = defineComponent({
      setup() {
        result = useHighlights('glossary', ranges, { className: 'term' });
        return () => null;
      },
    });
    const { container, editor } = await mount(() => (show.value ? [h(Marks)] : []));
    ranges.value = editor().findMatches('Supplier');
    await flush();
    expect(result!.value).toMatchObject({ applied: 3, unavailable: 0 });
    const painted = marks(container, 'glossary');
    expect(indexes(painted)).toEqual([0, 1, 2]);
    expect(painted.every((mark) => mark.classList.contains('term'))).toBe(true);

    show.value = false;
    await flush();
    expect(marks(container, 'glossary')).toHaveLength(0);
  });

  test('passes the proofing kind, so covered text reports aria-invalid', async () => {
    const kind = ref<'spelling' | 'grammar'>('spelling');
    const Marks = defineComponent({
      setup() {
        useHighlights(
          'proofing',
          (editor) => editor.findMatches('pays'),
          () => ({
            kind: kind.value,
          })
        );
        return () => null;
      },
    });
    const { container } = await mount(() => [h(Marks)]);
    const invalid = () =>
      [...container.querySelectorAll('[aria-invalid]')].map((span) =>
        span.getAttribute('aria-invalid')
      );
    expect(invalid()).toEqual(['spelling']);
    kind.value = 'grammar';
    await flush();
    expect(invalid()).toEqual(['grammar']);
  });

  test('a function source runs again after document changes', async () => {
    let runs = 0;
    const Marks = defineComponent({
      setup() {
        useHighlights('glossary', (editor) => {
          runs += 1;
          return editor.findMatches('Supplier');
        });
        return () => null;
      },
    });
    const { container, editor } = await mount(() => [h(Marks)]);
    expect(indexes(marks(container, 'glossary'))).toEqual([0, 1, 2]);
    const before = runs;
    const first = editor().findMatches('signs')[0]!;
    const caret = { paragraphId: first.blockId, offset: first.start };
    editor().exec({ type: 'setSelection', range: { anchor: caret, head: caret } });
    editor().exec({ type: 'insertText', text: 'Supplier ' });
    await wait(HIGHLIGHT_REFRESH_MS + 50);
    await flush();
    expect(runs).toBeGreaterThan(before);
    expect(indexes(marks(container, 'glossary'))).toEqual([0, 1, 2, 3]);
  });

  test('a fixed array is not reapplied after document changes', async () => {
    let calls = 0;
    const ranges = ref<readonly HighlightRange[]>([]);
    const Marks = defineComponent({
      setup() {
        useHighlights('glossary', ranges);
        return () => null;
      },
    });
    const { editor } = await mount(() => [h(Marks)]);
    const setHighlights = editor().setHighlights.bind(editor());
    editor().setHighlights = (...args) => {
      calls += 1;
      return setHighlights(...args);
    };
    ranges.value = editor().findMatches('Supplier');
    await flush();
    expect(calls).toBe(1);
    editor().exec({ type: 'insertText', text: 'X' });
    await wait(HIGHLIGHT_REFRESH_MS + 50);
    await flush();
    expect(calls).toBe(1);
  });

  test('a ref that holds an editor function also runs again after document changes', async () => {
    const source = ref((editor: Editor) => editor.findMatches('Supplier'));
    const Marks = defineComponent({
      setup() {
        useHighlights('glossary', source);
        return () => null;
      },
    });
    const { container, editor } = await mount(() => [h(Marks)]);
    expect(indexes(marks(container, 'glossary'))).toEqual([0, 1, 2]);
    const first = editor().findMatches('signs')[0]!;
    const caret = { paragraphId: first.blockId, offset: first.start };
    editor().exec({ type: 'setSelection', range: { anchor: caret, head: caret } });
    editor().exec({ type: 'insertText', text: 'Supplier ' });
    await wait(HIGHLIGHT_REFRESH_MS + 50);
    await flush();
    expect(indexes(marks(container, 'glossary'))).toEqual([0, 1, 2, 3]);
  });

  test('stale matches held in a deep ref are checked against the text they were found in', async () => {
    const ranges = ref<readonly HighlightRange[]>([]);
    const Marks = defineComponent({
      setup() {
        useHighlights('glossary', ranges);
        return () => null;
      },
    });
    const { container, editor } = await mount(() => [h(Marks)]);
    const stale = editor().findMatches('Supplier');
    // Edit inside the last match: its text no longer exists in the paragraph.
    const caret = { paragraphId: stale[2]!.blockId, offset: stale[2]!.start + 3 };
    editor().exec({ type: 'setSelection', range: { anchor: caret, head: caret } });
    editor().exec({ type: 'insertText', text: 'X' });
    ranges.value = stale;
    await flush();
    expect(indexes(marks(container, 'glossary'))).toEqual([0, 1]);
  });

  test('useHighlightAt reports the mark under the pointer, with the range fields you added', async () => {
    type GlossaryRange = TextMatch & { readonly definition: string };
    let hit: ReturnType<typeof useHighlightAt<GlossaryRange>> | null = null;
    const Marks = defineComponent({
      setup() {
        useHighlights('glossary', (editor): GlossaryRange[] =>
          editor.findMatches('signs').map((match) => ({ ...match, definition: 'Executes it.' }))
        );
        hit = useHighlightAt<GlossaryRange>('glossary');
        return () => null;
      },
    });
    const { container } = await mount(() => [h(Marks)]);
    const layer = container.querySelector<HTMLElement>('.docx-text-highlight-overlay')!;
    layer.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    const mark = marks(container, 'glossary')[0]!;
    const x = Number.parseFloat(mark.style.left) + 1;
    const y = Number.parseFloat(mark.style.top) + 1;
    container
      .querySelector('[data-page-index]')!
      .dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
    await wait(40);
    expect(hit!.value?.range.definition).toBe('Executes it.');
    document.body.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y })
    );
    await wait(40);
    expect(hit!.value).toBeNull();
  });
});

describe('useHighlights refresh', () => {
  test('runs a function source again for state that is not reactive, with a stable identity', async () => {
    // A plain dictionary: changing it is invisible to Vue and to the editor.
    const ignored = new Set<string>();
    let runs = 0;
    let highlights: ReturnType<typeof useHighlights> | null = null;
    const Marks = defineComponent({
      setup() {
        highlights = useHighlights('spelling', (editor) => {
          runs += 1;
          return editor
            .findMatches(['Supplier', 'signs'])
            .flat()
            .filter((match) => !ignored.has(match.text));
        });
        return () => null;
      },
    });
    const { container } = await mount(() => [h(Marks)]);
    expect(indexes(marks(container, 'spelling'))).toEqual([0, 1, 2, 3]);
    const before = runs;
    const refresh = highlights!.value.refresh;

    ignored.add('Supplier');
    highlights!.value.refresh();
    await flush();
    expect(runs).toBe(before + 1);
    expect(indexes(marks(container, 'spelling'))).toEqual([0]);
    expect(highlights!.value.applied).toBe(1);
    // The counts changed, and `refresh` is still the same function.
    expect(highlights!.value.refresh).toBe(refresh);
  });

  test('applies an array source again and does nothing after the scope ends', async () => {
    const ranges = ref<readonly HighlightRange[]>([]);
    const show = ref(true);
    let highlights: ReturnType<typeof useHighlights> | null = null;
    const Marks = defineComponent({
      setup() {
        highlights = useHighlights('glossary', ranges);
        return () => null;
      },
    });
    const { container, editor } = await mount(() => (show.value ? [h(Marks)] : []));
    ranges.value = editor().findMatches('Supplier');
    await flush();
    expect(indexes(marks(container, 'glossary'))).toEqual([0, 1, 2]);

    // Another owner removes the set; refresh applies the ranges again.
    editor().clearHighlights('glossary');
    expect(marks(container, 'glossary')).toHaveLength(0);
    highlights!.value.refresh();
    await flush();
    expect(indexes(marks(container, 'glossary'))).toEqual([0, 1, 2]);

    const refresh = highlights!.value.refresh;
    show.value = false;
    await flush();
    expect(() => refresh()).not.toThrow();
    await flush();
    expect(marks(container, 'glossary')).toHaveLength(0);
  });
});

describe('useHighlights refresh after an edit', () => {
  test('an edit and a refresh run a function source once, as in React', async () => {
    let runs = 0;
    let highlights: ReturnType<typeof useHighlights> | null = null;
    const Marks = defineComponent({
      setup() {
        highlights = useHighlights('glossary', (editor) => {
          runs += 1;
          return editor.findMatches('Supplier');
        });
        return () => null;
      },
    });
    const { editor } = await mount(() => [h(Marks)]);
    const before = runs;
    editor().exec({ type: 'insertText', text: 'X' });
    highlights!.value.refresh();
    await wait(HIGHLIGHT_REFRESH_MS + 50);
    await flush();
    expect(runs).toBe(before + 1);
  });
});

describe('context menu highlights', () => {
  type SpellingRange = TextMatch & { readonly suggestions: readonly string[] };
  let anchor: ContextMenuAnchor | null = null;
  let all: readonly HighlightHit[] = [];
  let spelling: readonly HighlightHit<SpellingRange>[] = [];

  const Suggestions = defineComponent({
    setup() {
      const opened = useContextMenuAnchor();
      const allHits = useContextMenuHighlights();
      const spellingHits = useContextMenuHighlights<SpellingRange>('spelling');
      watchEffect(() => {
        anchor = opened.value;
        all = allHits.value;
        spelling = spellingHits.value;
      });
      return () => {
        const [hit] = spellingHits.value;
        return hit
          ? hit.range.suggestions.map((word) => h(ContextMenu.Item, { key: word, label: word }))
          : null;
      };
    },
  });
  const Marks = defineComponent({
    setup() {
      useHighlights('spelling', (editor): SpellingRange[] =>
        editor.findMatches('signs').map((match) => ({ ...match, suggestions: ['sings'] }))
      );
      useHighlights('glossary', (editor) => editor.findMatches('The'));
      return () => null;
    },
  });

  async function mountMenu() {
    anchor = null;
    all = [];
    spelling = [];
    const view = await mount(
      () => [h(Marks)],
      // The menu answers right-clicks in its own viewport, so it renders inside it.
      () => [
        h(ContextMenu, null, {
          default: () => [h(ContextMenu.Start, null, { default: () => [h(Suggestions)] })],
        }),
      ]
    );
    const layer = view.container.querySelector<HTMLElement>('.docx-text-highlight-overlay')!;
    layer.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    return view;
  }

  async function rightClick(container: HTMLElement, init: MouseEventInit) {
    container
      .querySelector('.docx-paginated-surface')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...init }));
    await flush();
  }

  test('rows read the marks under the right-click, typed and filtered by set', async () => {
    const { container } = await mountMenu();
    const mark = marks(container, 'spelling')[0]!;
    const x = Number.parseFloat(mark.style.left) + 1;
    const y = Number.parseFloat(mark.style.top) + 1;
    await rightClick(container, { clientX: x, clientY: y, button: 2 });
    expect(anchor).toEqual({ x, y, trigger: 'pointer' });
    expect(spelling).toHaveLength(1);
    expect(spelling[0]!.range.suggestions).toEqual(['sings']);
    expect(all.length).toBeGreaterThanOrEqual(1);
    const rows = [...container.querySelectorAll('.docx-contextmenu [role="menuitem"]')];
    expect(rows[0]?.textContent).toBe('sings');
  });

  test('an edit while the menu is open never leaves a hit on text that moved', async () => {
    const { container, editor } = await mountMenu();
    const mark = marks(container, 'spelling')[0]!;
    const x = Number.parseFloat(mark.style.left) + 1;
    const y = Number.parseFloat(mark.style.top) + 1;
    await rightClick(container, { clientX: x, clientY: y, button: 2 });
    const before = spelling[0]!;
    expect(before.start).toBe(editor().findMatches('signs')[0]!.start);
    // A collaborator types at the paragraph start while the menu stays open.
    const caret = { blockId: before.range.blockId, offset: 0 };
    editor().exec({ type: 'setSelection', range: { anchor: caret, head: caret } });
    editor().exec({ type: 'insertText', text: 'Now ' });
    await flush();
    expect(container.querySelector('.docx-contextmenu')).not.toBeNull();
    const now = editor().findMatches('signs')[0]!;
    expect(now.start).toBe(before.start + 4);
    // Read again at the same point: either the moved word with its new offsets, or nothing.
    expect(spelling.every((hit) => hit.start === now.start && hit.length === now.length)).toBe(
      true
    );
    expect(spelling).not.toContain(before);
  });

  test('a press away from any mark reads no marks', async () => {
    const { container } = await mountMenu();
    await rightClick(container, { clientX: 5000, clientY: 5000, button: 2 });
    expect(anchor?.trigger).toBe('pointer');
    expect(all).toEqual([]);
  });

  /**
   * The test DOM has no layout: every element reports a zero rectangle, so the caret's host
   * and the mark layer disagree by the page offset. Place the mark layer so that the start of
   * the marked word sits where the caret paints at that offset, as in a browser.
   */
  async function alignMarksWithCaret(container: HTMLElement, editor: DocxEditorInstance) {
    const match = editor.findMatches('signs')[0]!;
    const start = { blockId: match.blockId, offset: match.start };
    editor.exec({ type: 'setSelection', range: { anchor: start, head: start } });
    await flush();
    const caret = editor.getCaretRect()!;
    const mark = marks(container, 'spelling')[0]!;
    const layer = container.querySelector<HTMLElement>('.docx-text-highlight-overlay')!;
    const left = caret.left - Number.parseFloat(mark.style.left);
    const top = caret.top - Number.parseFloat(mark.style.top);
    layer.getBoundingClientRect = () => ({ left, top }) as DOMRect;
  }

  async function keyboardOpenAt(
    container: HTMLElement,
    editor: DocxEditorInstance,
    offsetInWord: number,
    word = 'signs'
  ) {
    await alignMarksWithCaret(container, editor);
    const match = editor.findMatches(word)[0]!;
    const caret = { blockId: match.blockId, offset: match.start + offsetInWord };
    editor.exec({ type: 'setSelection', range: { anchor: caret, head: caret } });
    await flush();
    // Shift+F10 and the Menu key report no pointer position.
    await rightClick(container, { clientX: 0, clientY: 0, button: -1 });
  }

  test('a keyboard open reads the marks at the caret, inside the word and at both edges', async () => {
    for (const offset of [2, 0, 5]) {
      const { container, editor } = await mountMenu();
      await keyboardOpenAt(container, editor(), offset);
      expect(container.querySelector('.docx-contextmenu')).not.toBeNull();
      expect(anchor?.trigger).toBe('keyboard');
      expect(spelling).toHaveLength(1);
      expect(spelling[0]!.start).toBe(editor().findMatches('signs')[0]!.start);
      expect(spelling[0]!.range.suggestions).toEqual(['sings']);
      const rows = [...container.querySelectorAll('.docx-contextmenu [role="menuitem"]')];
      expect(rows[0]?.textContent).toBe('sings');
    }
  });

  test('a keyboard open away from any mark reads no marks', async () => {
    const { container, editor } = await mountMenu();
    // "pays" in the first paragraph carries no mark.
    await keyboardOpenAt(container, editor(), 2, 'pays');
    expect(container.querySelector('.docx-contextmenu')).not.toBeNull();
    expect(anchor?.trigger).toBe('keyboard');
    expect(all).toEqual([]);
  });
});

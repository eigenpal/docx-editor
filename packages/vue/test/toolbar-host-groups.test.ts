// Host groups, slot replacement, hidden groups, the clamped "⋯" panel, the table-size grid,
// Add Comment, and the collapsing menu bar, in the Vue adapter.
import './dom-setup.ts';

import { afterEach, describe, expect, mock, test } from 'bun:test';
import { defineComponent, h, onBeforeUnmount } from 'vue';
import type { EditorModule } from '@docx-editor.dev/core/editor';
import { DocxEditorToolbar as T } from '../src/editor/toolbar';
import { DocxEditorMenu } from '../src/editor/menu';
import { useReviewRailRegistry } from '../src/editor/context';
import { flush, mountEditorTree } from './helpers/mount';

class MockResizeObserver {
  static readonly instances: MockResizeObserver[] = [];
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    const index = MockResizeObserver.instances.indexOf(this);
    if (index >= 0) MockResizeObserver.instances.splice(index, 1);
  }
  flush(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const RealResizeObserver = globalThis.ResizeObserver;

afterEach(() => {
  document.body.innerHTML = '';
  globalThis.ResizeObserver = RealResizeObserver;
  MockResizeObserver.instances.length = 0;
});

function useMockObserver(): void {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
}

async function measure(bar: HTMLElement, barWidth: number, groupWidth = 90): Promise<void> {
  Object.defineProperty(bar, 'clientWidth', { configurable: true, get: () => barWidth });
  for (const element of bar.querySelectorAll('[data-toolbar-group], [data-toolbar-fixed]')) {
    Object.defineProperty(element, 'offsetWidth', { configurable: true, get: () => groupWidth });
  }
  for (const observer of [...MockResizeObserver.instances]) observer.flush();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await flush();
}

function barShape(toolbar: Element): string[] {
  return [...toolbar.children].map((child) =>
    child.getAttribute('role') === 'separator'
      ? '|'
      : (child.getAttribute('data-toolbar-group') ??
        (child.hasAttribute('data-toolbar-fixed') ? 'fixed' : child.className))
  );
}

const t = (key: string) => (key === 'formattingBar.more' ? 'More' : key);

const toolbarOf = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-testid="docx-toolbar"]')!;

describe('Vue Toolbar.Group', () => {
  test('a host group is measured, collapses, and shows its actions as panel rows', async () => {
    useMockObserver();
    const onSelect = mock(() => {});
    const view = mountEditorTree(() =>
      h(T, { t }, () => [
        h(T.Group, { id: 'review-nav', label: 'Review navigation' }, () => [
          h(T.Action, { label: 'Next change', onSelect }),
        ]),
      ])
    );
    await flush();
    const toolbar = toolbarOf(view.container);
    const group = toolbar.querySelector('[data-toolbar-group="review-nav"]');
    expect(group?.getAttribute('role')).toBe('group');
    expect(group?.getAttribute('aria-label')).toBe('Review navigation');
    const shape = barShape(toolbar);
    expect(shape.indexOf('review-nav')).toBe(shape.lastIndexOf('|') + 1);
    expect(shape.filter((entry) => entry === 'fixed').length).toBe(1);

    await measure(toolbar, 420);
    expect(toolbar.querySelector('[data-toolbar-group="review-nav"]')).toBeNull();
    toolbar.querySelector<HTMLButtonElement>('[aria-label="More"]')!.click();
    await flush();
    const panel = view.container.querySelector('[data-testid="toolbar-overflow-panel"]')!;
    const row = panel.querySelector<HTMLButtonElement>(
      '[aria-label="Review navigation"] .docx-toolbar__more-command'
    );
    expect(row?.textContent).toContain('Next change');
    row!.click();
    await flush();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('[data-testid="toolbar-overflow-panel"]')).toBeNull();
    view.unmount();
  });

  test('after, built-in ids, hidden groups, and all-hidden groups', async () => {
    const view = mountEditorTree(() =>
      h(T, null, () => [
        h(T.Group, { id: 'mine', label: 'Mine', after: 'history' }, () => [
          h(T.Action, { label: 'Go' }),
        ]),
        h(T.Group, { id: 'font' }, () => [h(T.Action, { label: 'Extra' })]),
        h(T.Group, { id: 'zoom', hidden: true }),
        h(T.EditingMode, { hidden: true }),
        h(T.Comments, { hidden: true }),
        h(T.Button, { slot: 'review.revisionMarkup', hidden: true }),
      ])
    );
    await flush();
    const toolbar = toolbarOf(view.container);
    const shape = barShape(toolbar);
    expect(shape.slice(0, 3)).toEqual(['history', '|', 'mine']);
    expect(
      toolbar.querySelector('[data-toolbar-group="font"] [aria-label="Extra"]')
    ).not.toBeNull();
    expect(toolbar.querySelector('[data-toolbar-group="zoom"]')).toBeNull();
    // The review group lost every slot: no empty group, no trailing or doubled separator.
    expect(shape).not.toContain('fixed');
    expect(shape[shape.length - 1]).not.toBe('|');
    expect(shape.join(' ')).not.toContain('| |');
    const groups = [...toolbar.querySelectorAll('.docx-toolbar__group')];
    expect(groups.every((element) => element.children.length > 0)).toBe(true);
    view.unmount();
  });

  test('a template-style empty hidden attribute hides a slot', async () => {
    const view = mountEditorTree(() => h(T, null, () => [h(T.Zoom, { hidden: '' })]));
    await flush();
    expect(toolbarOf(view.container).querySelector('[data-toolbar-group="zoom"]')).toBeNull();
    view.unmount();
  });

  test('unknown anchors and slot ids warn', async () => {
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      const view = mountEditorTree(() =>
        h(T, null, () => [
          h(T.Group, { id: 'vue-mine', after: 'vue-missing' }, () => [
            h(T.Action, { label: 'Go' }),
          ]),
          h(T.Slot, { slot: 'vue.nope' as never }, () => [h('span')]),
        ])
      );
      await flush();
      view.unmount();
    } finally {
      console.warn = original;
    }
    const messages = warn.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(messages.some((text) => text.includes('vue-missing'))).toBe(true);
    expect(messages.some((text) => text.includes('vue.nope'))).toBe(true);
  });
});

describe('Vue Toolbar.Slot', () => {
  test('replaces a built-in slot in place and collapses with its group', async () => {
    useMockObserver();
    const view = mountEditorTree(() =>
      h(T, { t }, () => [
        h(
          T.Slot,
          { slot: 'zoom.level', overflowContent: () => h('span', { 'data-testid': 'panel-zoom' }) },
          () => [h('button', { type: 'button', 'data-testid': 'my-zoom' }, 'Z')]
        ),
      ])
    );
    await flush();
    const toolbar = toolbarOf(view.container);
    expect(
      toolbar.querySelector('[data-toolbar-group="zoom"] [data-testid="my-zoom"]')
    ).not.toBeNull();
    expect(toolbar.querySelector('[data-slot="zoom.level"]')).toBeNull();
    await measure(toolbar, 760);
    toolbar.querySelector<HTMLButtonElement>('[aria-label="More"]')!.click();
    await flush();
    const panel = view.container.querySelector('[data-testid="toolbar-overflow-panel"]')!;
    expect(panel.querySelector('[data-testid="panel-zoom"]')).not.toBeNull();
    view.unmount();
  });
});

describe('Vue overflow panel placement', () => {
  test('stays inside a narrow viewport', async () => {
    useMockObserver();
    const view = mountEditorTree(() => h(T, { t }));
    await flush();
    const toolbar = toolbarOf(view.container);
    await measure(toolbar, 300);
    const trigger = toolbar.querySelector<HTMLButtonElement>('[aria-label="More"]')!;
    const rect = { left: 178, right: 212, top: 0, bottom: 34, width: 34, height: 34 } as DOMRect;
    trigger.getBoundingClientRect = () => rect;
    trigger.parentElement!.getBoundingClientRect = () => rect;
    const innerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('docx-toolbar__more-panel') ? 340 : 0;
      },
    });
    try {
      trigger.click();
      await flush();
      const panel = view.container.querySelector<HTMLElement>(
        '[data-testid="toolbar-overflow-panel"]'
      )!;
      expect(panel.getAttribute('data-anchor')).toBe('clamped');
      expect(panel.style.left).toBe('-170px');
      expect(panel.style.maxInlineSize).toBe('374px');
    } finally {
      if (offsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth);
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
    }
    view.unmount();
  });
});

describe('Vue TableInsert and AddComment', () => {
  test('the table part opens a size grid and inserts the picked size', async () => {
    const view = mountEditorTree(() => h(T, { preset: false }, () => [h(T.TableInsert)]));
    await flush();
    const trigger = view.container.querySelector<HTMLButtonElement>('[data-slot="table.insert"]')!;
    expect(trigger.disabled).toBe(false);
    expect(trigger.getAttribute('aria-haspopup')).toBe('grid');
    trigger.click();
    await flush();
    const grid = view.container.querySelector('[role="grid"]')!;
    expect(grid.querySelectorAll('[role="gridcell"]').length).toBe(36);
    const editor = view.editor();
    const exec = editor.exec.bind(editor);
    const calls: unknown[] = [];
    editor.exec = ((command: unknown) => {
      calls.push(command);
      return exec(command as never);
    }) as typeof exec;
    grid.querySelector<HTMLButtonElement>('[data-cell="2x3"]')!.click();
    await flush();
    expect(calls).toContainEqual({ type: 'insertTable', rows: 2, cols: 3 });
    expect(view.container.querySelector('[role="grid"]')).toBeNull();
    view.unmount();
  });

  test('Add Comment requests a comment draft from the review rail', async () => {
    const onDraft = mock(() => {});
    const FakeRail = defineComponent({
      setup() {
        const rail = useReviewRailRegistry();
        const unregister = rail.value.register();
        const release = rail.value.registerCommentDraft(onDraft);
        onBeforeUnmount(() => {
          unregister();
          release();
        });
        return () => null;
      },
    });
    const review: EditorModule = {
      id: 'review',
      review: {
        displayModes: ['all-markup', 'proposed', 'original'],
        collectReviewItems: () => [],
        revisionItemsOfParagraph: () => [],
      },
    } as EditorModule;
    const view = mountEditorTree(
      () => [h(T, { preset: false }, () => [h(T.AddComment)]), h(FakeRail)],
      undefined,
      () => [],
      [review]
    );
    await flush();
    const editor = view.editor();
    // happy-dom lays nothing out, so the selection has no place on the page by itself.
    (editor as unknown as { getSelectionPlacement: () => unknown }).getSelectionPlacement = () => ({
      anchorY: 10,
    });
    const paragraph = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraph, offset: 0 },
      head: { paragraphId: paragraph, offset: 5 },
    });
    await flush();
    const button = view.container.querySelector<HTMLButtonElement>('[data-part="add-comment"]')!;
    expect(button.disabled).toBe(false);
    button.click();
    expect(onDraft).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});

describe('Vue menu bar overflow', () => {
  test('menus that do not fit move into one "⋯" menu, from the end', async () => {
    useMockObserver();
    const view = mountEditorTree(() => h(DocxEditorMenu, { t }));
    await flush();
    const bar = view.container.querySelector<HTMLElement>('[data-testid="docx-menubar"]')!;
    expect(bar.hasAttribute('data-overflow')).toBe(true);
    const triggers = () =>
      [...bar.querySelectorAll(':scope > [data-menu] > .docx-menubar__trigger')].map((trigger) =>
        trigger.closest('[data-menu]')!.getAttribute('data-menu')
      );
    await measure(bar, 2000, 60);
    expect(triggers()).toEqual(['file', 'format', 'insert', 'review', 'help']);
    await measure(bar, 220, 60);
    expect(triggers()).toEqual(['file', 'format', 'insert', 'docx-menubar-more']);
    const more = bar.querySelector<HTMLElement>('[aria-label="More"]')!;
    expect(more.getAttribute('role')).toBe('menuitem');
    more.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await flush();
    const panel = bar.querySelector('[data-menu="docx-menubar-more"] > [role="menu"]')!;
    const rows = [...panel.querySelectorAll(':scope > [role="none"] > [role="menuitem"]')];
    expect(rows.map((row) => row.getAttribute('aria-haspopup'))).toEqual(['menu', 'menu']);
    expect(rows[0]!.textContent).toContain('toolbar.review');
    await measure(bar, 2000, 60);
    expect(triggers()).toEqual(['file', 'format', 'insert', 'review', 'help']);
    view.unmount();
  });

  test('overflow=false wraps and does not measure', async () => {
    const view = mountEditorTree(() => h(DocxEditorMenu, { overflow: false }));
    await flush();
    const bar = view.container.querySelector<HTMLElement>('[data-testid="docx-menubar"]')!;
    expect(bar.hasAttribute('data-overflow')).toBe(false);
    expect(bar.querySelector('[data-toolbar-group]')).toBeNull();
    view.unmount();
  });
});

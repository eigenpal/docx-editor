// Host groups, slot replacement, hidden groups, the clamped "⋯" panel, the table-size grid
// and Add Comment in the preset toolbar.
//
// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { useContext, useEffect, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { ReviewRailContext } from '../src/editor/context.ts';
import { DocxEditorToolbar as T } from '../src/editor/toolbar/index.ts';
import {
  arrangeToolbarGroups,
  collapseOrder,
  toolbarPanelPlacement,
} from '../src/editor/toolbar/toolbar-overflow.ts';
import { en } from '@docx-editor.dev/i18n';
import { barRoomWidth, readAvailableWidth } from '../src/editor/toolbar/toolbar-measure.ts';
import { testReviewModule } from './review-test-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');

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

const RealResizeObserver = global.ResizeObserver;

beforeEach(() => {
  MockResizeObserver.instances.length = 0;
  global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  global.ResizeObserver = RealResizeObserver;
});

function mount(
  toolbar: ReactNode,
  options: {
    modules?: boolean;
    extra?: ReactNode;
    onReady?: (editor: DocxEditorInstance) => void;
  } = {}
): { view: ReturnType<typeof render>; editor: () => DocxEditorInstance } {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={SOURCE}
      {...(options.modules ? { modules: [testReviewModule()] } : {})}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
        options.onReady?.(instance);
      }}
    >
      {toolbar}
      {options.extra}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

/** Measure every group at `groupWidth` and the bar at `barWidth`, then flush the observer. */
async function measure(toolbar: HTMLElement, barWidth: number, groupWidth = 90): Promise<void> {
  Object.defineProperty(toolbar, 'clientWidth', { configurable: true, get: () => barWidth });
  for (const element of toolbar.querySelectorAll('[data-toolbar-group], [data-toolbar-fixed]')) {
    Object.defineProperty(element, 'offsetWidth', { configurable: true, get: () => groupWidth });
  }
  await act(async () => {
    for (const observer of [...MockResizeObserver.instances]) observer.flush();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

/** Group ids and separators of the bar, in order. */
function barShape(toolbar: HTMLElement): string[] {
  return [...toolbar.children].map((child) =>
    child.getAttribute('role') === 'separator'
      ? '|'
      : (child.getAttribute('data-toolbar-group') ??
        (child.hasAttribute('data-toolbar-fixed') ? 'fixed' : child.className))
  );
}

const t = (key: string) => (key === 'formattingBar.more' ? 'More' : key);

describe('toolbar group policy', () => {
  test('a host priority sorts among the built-in priorities', () => {
    const groups = ['history', 'zoom', 'font', 'nav', 'review-nav'];
    const order = collapseOrder(groups, undefined, new Map([['nav', 75]]));
    // `review-nav` has no priority, so it goes first; `nav` (75) sits between font and history.
    expect(order).toEqual(['review-nav', 'zoom', 'font', 'nav', 'history']);
  });

  test('host groups follow the built-in groups, or the group they name', () => {
    expect(
      arrangeToolbarGroups(
        ['history', 'text', 'review'],
        [
          { id: 'a' },
          { id: 'b', after: 'history' },
          { id: 'c', after: 'history' },
          { id: 'd', after: 'b' },
        ]
      )
    ).toEqual(['history', 'b', 'd', 'c', 'text', 'review', 'a']);
    expect(arrangeToolbarGroups(['history'], [{ id: 'x', after: 'missing' }])).toEqual([
      'history',
      'x',
    ]);
  });

  test('the panel lines up with the trigger end, then its start, then clamps', () => {
    const base = { panelWidth: 300, viewportWidth: 1000 };
    expect(toolbarPanelPlacement({ ...base, triggerLeft: 900, triggerRight: 934 })).toEqual({
      left: 634,
      maxWidth: 984,
      anchor: 'end',
    });
    expect(toolbarPanelPlacement({ ...base, triggerLeft: 20, triggerRight: 54 }).anchor).toBe(
      'start'
    );
    const narrow = toolbarPanelPlacement({
      panelWidth: 340,
      viewportWidth: 390,
      triggerLeft: 178,
      triggerRight: 212,
    });
    expect(narrow.anchor).toBe('clamped');
    expect(narrow.left).toBe(8);
    expect(narrow.maxWidth).toBe(374);
  });
});

describe('Toolbar.Group', () => {
  test('a host group is measured, collapses, and shows its actions as labelled panel rows', async () => {
    const onSelect = mock(() => {});
    const { view } = mount(
      <T t={t}>
        <T.Group id="review-nav" label="Review navigation">
          <T.Action label="Next change" onSelect={onSelect} />
        </T.Group>
      </T>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    const group = toolbar.querySelector<HTMLElement>('[data-toolbar-group="review-nav"]');
    expect(group).not.toBeNull();
    expect(group!.getAttribute('role')).toBe('group');
    expect(group!.getAttribute('aria-label')).toBe('Review navigation');
    // After the review group, which is the last built-in group, and before contextual chrome.
    const shape = barShape(toolbar);
    expect(shape.indexOf('review-nav')).toBe(shape.lastIndexOf('|') + 1);
    // No fixed block of loose children: only the pinned review group is fixed.
    expect(shape.filter((entry) => entry === 'fixed').length).toBe(1);

    await measure(toolbar, 420);
    // No priority: it collapses before every built-in group.
    expect(toolbar.querySelector('[data-toolbar-group="review-nav"]')).toBeNull();
    await act(async () => {
      view.getByLabelText('More').click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    const section = panel.querySelector('[role="group"][aria-label="Review navigation"]');
    expect(section).not.toBeNull();
    const row = section!.querySelector<HTMLButtonElement>('.docx-toolbar__more-command');
    expect(row?.textContent).toContain('Next change');
    await act(async () => {
      fireEvent.click(row!);
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    // The row closes the panel.
    expect(view.queryByTestId('toolbar-overflow-panel')).toBeNull();
  });

  test('a priority keeps a host group in the bar longer than a built-in group', async () => {
    const { view } = mount(
      <T t={t}>
        <T.Group id="nav" label="Nav" priority={95}>
          <T.Action label="Go" />
        </T.Group>
      </T>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    await measure(toolbar, 300);
    expect(toolbar.querySelector('[data-toolbar-group="nav"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-toolbar-group="history"]')).toBeNull();
  });

  test('after places a host group behind the group it names', () => {
    const { view } = mount(
      <T>
        <T.Group id="mine" label="Mine" after="history">
          <T.Action label="Go" />
        </T.Group>
      </T>
    );
    const shape = barShape(view.getByTestId('docx-toolbar'));
    expect(shape.slice(0, 3)).toEqual(['history', '|', 'mine']);
  });

  test('an unknown anchor or slot id warns in development', () => {
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      mount(
        <T>
          <T.Group id="mine" label="Mine" after="no-such-group">
            <T.Action label="Go" />
          </T.Group>
          <T.Slot slot={'no.such' as never}>
            <span />
          </T.Slot>
        </T>
      );
    } finally {
      console.warn = original;
    }
    const messages = warn.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(messages.some((text) => text.includes('no-such-group'))).toBe(true);
    expect(messages.some((text) => text.includes('no.such'))).toBe(true);
  });

  test('a built-in id adds controls to that group, and they collapse with it', async () => {
    const { view } = mount(
      <T t={t}>
        <T.Group id="zoom">
          <T.Action label="Fit page" />
        </T.Group>
      </T>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    const zoom = toolbar.querySelector('[data-toolbar-group="zoom"]')!;
    expect(zoom.querySelector('[aria-label="Fit page"]')).not.toBeNull();
    expect(zoom.querySelector('[data-slot="zoom.level"]')).not.toBeNull();
    await measure(toolbar, 760);
    expect(toolbar.querySelector('[data-toolbar-group="zoom"]')).toBeNull();
    await act(async () => {
      view.getByLabelText('More').click();
    });
    const section = view
      .getByTestId('toolbar-overflow-panel')
      .querySelector('[aria-label="formattingBar.groups.zoom"]')!;
    expect(section.querySelector('[data-slot="zoom.level"]')).not.toBeNull();
    expect(section.textContent).toContain('Fit page');
  });

  test('hidden removes a built-in group and its separator', () => {
    const { view } = mount(
      <T>
        <T.Group id="zoom" hidden />
      </T>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    expect(toolbar.querySelector('[data-toolbar-group="zoom"]')).toBeNull();
    expect(toolbar.querySelector('[data-slot="zoom.level"]')).toBeNull();
    expect(barShape(toolbar).join(' ')).not.toContain('| |');
  });

  test('a group whose slots are all hidden leaves no empty group or separator', async () => {
    const { view } = mount(
      <T t={t}>
        <T.Zoom hidden />
        <T.EditingMode hidden />
        <T.Comments hidden />
        <T.Button slot="review.revisionMarkup" hidden />
      </T>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    const groups = [...toolbar.querySelectorAll('.docx-toolbar__group')];
    expect(groups.every((group) => group.children.length > 0)).toBe(true);
    expect(toolbar.querySelector('[data-toolbar-group="zoom"]')).toBeNull();
    const shape = barShape(toolbar);
    expect(shape[shape.length - 1]).not.toBe('|');
    expect(shape.join(' ')).not.toContain('| |');
    const separators = shape.filter((entry) => entry === '|').length;
    expect(separators).toBe(groups.length - 1);

    await measure(toolbar, 420);
    await act(async () => {
      view.getByLabelText('More').click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    expect(panel.querySelector('[aria-label="formattingBar.groups.zoom"]')).toBeNull();
    for (const section of panel.querySelectorAll('.docx-toolbar__more-section')) {
      expect(section.children.length).toBeGreaterThan(1);
    }
  });
});

describe('Toolbar.Slot', () => {
  test('replaces a built-in slot in place and collapses with its group', async () => {
    const { view } = mount(
      <T t={t}>
        <T.Slot slot="zoom.level" overflowContent={() => <span data-testid="panel-zoom" />}>
          <button type="button" data-testid="my-zoom">
            Z
          </button>
        </T.Slot>
      </T>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    const zoom = toolbar.querySelector('[data-toolbar-group="zoom"]')!;
    expect(zoom.querySelector('[data-testid="my-zoom"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-slot="zoom.level"]')).toBeNull();
    // Not appended: only the pinned review group is fixed.
    expect(barShape(toolbar).filter((entry) => entry === 'fixed').length).toBe(1);

    await measure(toolbar, 760);
    await act(async () => {
      view.getByLabelText('More').click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    expect(panel.querySelector('[data-testid="panel-zoom"]')).not.toBeNull();
    expect(panel.querySelector('[data-testid="my-zoom"]')).toBeNull();
  });
});

describe('shrink-wrapped toolbar', () => {
  test('the room comes from the parent, less siblings and margins, capped by max-width', () => {
    const base = { own: 300, siblings: 0, margins: 0, chrome: 10, maxWidth: null };
    // A bar that fills its container keeps its own measurement.
    expect(barRoomWidth({ ...base, own: 990, parentContent: 1000 })).toBe(990);
    // A shrink-wrapped bar can grow into the parent.
    expect(barRoomWidth({ ...base, parentContent: 1000 })).toBe(990);
    expect(barRoomWidth({ ...base, parentContent: 1000, siblings: 200, margins: 20 })).toBe(770);
    expect(barRoomWidth({ ...base, parentContent: 1000, maxWidth: 600 })).toBe(590);
    // Never less than the box it has, and unknown room keeps the box.
    expect(barRoomWidth({ ...base, parentContent: 100 })).toBe(300);
    expect(barRoomWidth({ ...base, parentContent: 0 })).toBe(300);
  });

  test('groups come back when the window widens again', async () => {
    const { view } = mount(<T t={t} />);
    const toolbar = view.getByTestId('docx-toolbar');
    const parent = toolbar.parentElement!;
    parent.style.display = 'flex';
    parent.style.justifyContent = 'center';
    toolbar.style.width = 'max-content';
    toolbar.style.maxWidth = '100%';
    toolbar.style.boxSizing = 'border-box';
    (toolbar as unknown as { computedStyleMap: () => unknown }).computedStyleMap = () => ({
      get: (property: string) => (property === 'width' ? { value: 'max-content' } : undefined),
    });
    let room = 2000;
    Object.defineProperty(parent, 'clientWidth', { configurable: true, get: () => room });
    // The bar is exactly as wide as what it shows.
    const contentWidth = () =>
      toolbar.querySelectorAll('[data-toolbar-group]').length * 90 +
      toolbar.querySelectorAll('[data-toolbar-fixed]').length * 90 +
      (toolbar.querySelector('[data-toolbar-more]') ? 34 : 0);
    Object.defineProperty(toolbar, 'clientWidth', {
      configurable: true,
      get: () => Math.min(contentWidth(), room),
    });
    Object.defineProperty(toolbar, 'offsetWidth', {
      configurable: true,
      get: () => Math.min(contentWidth(), room),
    });
    const flushGroups = async () => {
      for (const element of toolbar.querySelectorAll(
        '[data-toolbar-group], [data-toolbar-fixed]'
      )) {
        Object.defineProperty(element, 'offsetWidth', { configurable: true, get: () => 90 });
      }
      await act(async () => {
        for (const observer of [...MockResizeObserver.instances]) observer.flush();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
    };
    await flushGroups();
    const all = toolbar.querySelectorAll('[data-toolbar-group]').length;
    expect(view.queryByLabelText('More')).toBeNull();

    room = 400;
    await flushGroups();
    expect(toolbar.querySelectorAll('[data-toolbar-group]').length).toBeLessThan(all);
    expect(view.getByLabelText('More')).not.toBeNull();

    room = 2000;
    await flushGroups();
    expect(toolbar.querySelectorAll('[data-toolbar-group]').length).toBe(all);
    expect(view.queryByLabelText('More')).toBeNull();
  });
});

describe('overflow panel placement', () => {
  test('stays inside a narrow viewport', async () => {
    const { view } = mount(<T t={t} />);
    const toolbar = view.getByTestId('docx-toolbar');
    await measure(toolbar, 300);
    const trigger = view.getByLabelText('More');
    const root = trigger.parentElement!;
    trigger.getBoundingClientRect = () =>
      ({ left: 178, right: 212, top: 0, bottom: 34, width: 34, height: 34 }) as DOMRect;
    root.getBoundingClientRect = () =>
      ({ left: 178, right: 212, top: 0, bottom: 34, width: 34, height: 34 }) as DOMRect;
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
      await act(async () => {
        trigger.click();
      });
      const panel = view.getByTestId('toolbar-overflow-panel');
      expect(panel.getAttribute('data-anchor')).toBe('clamped');
      // 8px from the viewport's left edge, in the trigger root's coordinates.
      expect(panel.style.left).toBe('-170px');
      expect(panel.style.maxInlineSize).toBe('374px');
    } finally {
      if (offsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth);
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth });
    }
  });
});

describe('available width', () => {
  /** A parent with a bar of `own` px; the bar specifies `width` through a Typed OM stub. */
  function layout(options: {
    parent: string;
    parentWidth: number;
    own: number;
    width?: string;
    barStyle?: string;
    margins?: { left: string; right: string };
    siblings?: {
      style: string;
      width: number;
      margins?: [string, string];
      tag?: string;
      text?: string;
    }[];
    typedOm?: boolean;
    scrollWidth?: number;
  }): HTMLElement {
    const parent = document.createElement('div');
    parent.setAttribute('style', options.parent);
    Object.defineProperty(parent, 'clientWidth', {
      configurable: true,
      get: () => options.parentWidth,
    });
    const bar = document.createElement('div');
    bar.setAttribute('style', `${options.barStyle ?? ''}`);
    Object.defineProperty(bar, 'clientWidth', { configurable: true, get: () => options.own });
    Object.defineProperty(bar, 'offsetWidth', { configurable: true, get: () => options.own });
    Object.defineProperty(bar, 'scrollWidth', {
      configurable: true,
      get: () => options.scrollWidth ?? options.own,
    });
    const keywords: Record<string, string> = {};
    if (options.width) keywords.width = options.width;
    if (options.margins?.left === 'auto') keywords['margin-left'] = 'auto';
    if (options.margins?.right === 'auto') keywords['margin-right'] = 'auto';
    if (options.typedOm !== false) {
      (bar as unknown as { computedStyleMap: () => unknown }).computedStyleMap = () => ({
        get: (property: string) =>
          property in keywords ? { value: keywords[property] } : { value: 0, unit: 'px' },
      });
    }
    for (const sibling of options.siblings ?? []) {
      const node = document.createElement(sibling.tag ?? 'div');
      node.setAttribute('style', sibling.style);
      if (sibling.text) node.textContent = sibling.text;
      Object.defineProperty(node, 'offsetWidth', { configurable: true, get: () => sibling.width });
      const [left, right] = sibling.margins ?? ['', ''];
      (node as unknown as { computedStyleMap: () => unknown }).computedStyleMap = () => ({
        get: (property: string) =>
          (property === 'margin-left' && left === 'auto') ||
          (property === 'margin-right' && right === 'auto')
            ? { value: 'auto' }
            : { value: 0, unit: 'px' },
      });
      parent.appendChild(node);
    }
    parent.appendChild(bar);
    document.body.appendChild(parent);
    return bar;
  }
  const available = (bar: HTMLElement) => readAvailableWidth(bar, getComputedStyle(bar));

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('a content-sized bar in a flex row gets the parent room', () => {
    const bar = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
    });
    expect(available(bar)).toBe(1000);
  });

  test('a bar in a grid cell, or with a fixed width, keeps its own box', () => {
    const grid = layout({
      parent: 'display: grid; grid-template-columns: auto 1fr auto',
      parentWidth: 1000,
      own: 300,
      width: 'auto',
    });
    expect(available(grid)).toBe(300);
    document.body.innerHTML = '';
    const fixed = layout({ parent: 'display: flex', parentWidth: 1000, own: 600 });
    expect(available(fixed)).toBe(600);
    document.body.innerHTML = '';
    const inline = layout({
      parent: 'display: block',
      parentWidth: 1000,
      own: 300,
      width: 'auto',
      barStyle: 'display: inline-flex',
    });
    expect(available(inline)).toBe(300);
  });

  test('without Typed OM the bar keeps its own box', () => {
    const bar = layout({ parent: 'display: flex', parentWidth: 1000, own: 300, typedOm: false });
    expect(available(bar)).toBe(300);
  });

  test('equal fixed margins count, auto margins do not', () => {
    const fixed = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      barStyle: 'margin: 0 40px',
    });
    expect(available(fixed)).toBe(920);
    document.body.innerHTML = '';
    const centered = layout({
      parent: 'display: block',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      barStyle: 'margin: 0 350px',
      margins: { left: 'auto', right: 'auto' },
    });
    expect(available(centered)).toBe(1000);
  });

  test('an unresolved max-width, an overflowing bar, and a floated bar keep their own box', () => {
    const calc = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      barStyle: 'max-width: calc(100% - 200px)',
    });
    expect(available(calc)).toBe(300);
    document.body.innerHTML = '';
    const overflowing = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      scrollWidth: 420,
    });
    expect(available(overflowing)).toBe(300);
    document.body.innerHTML = '';
    const floated = layout({
      parent: 'display: block',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      barStyle: 'float: left',
    });
    expect(available(floated)).toBe(300);
  });

  test('a growing sibling with content keeps the bar to its own box', () => {
    const bar = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      siblings: [{ style: 'flex: 1 1 0px', width: 600, tag: 'input' }],
    });
    expect(available(bar)).toBe(300);
    document.body.innerHTML = '';
    const titled = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      siblings: [{ style: 'flex: 1 1 0px', width: 600, text: 'Quarterly plan' }],
    });
    expect(available(titled)).toBe(300);
  });

  test('a flex: 1 spacer and an auto margin do not take the room', () => {
    const bar = layout({
      parent: 'display: flex',
      parentWidth: 1000,
      own: 300,
      width: 'max-content',
      siblings: [
        { style: 'flex: 1 1 0px', width: 500 },
        { style: 'margin-left: 100px', width: 100, margins: ['auto', ''] },
      ],
    });
    // 1000 less the 100px button; the spacer and the auto margin are free space.
    expect(available(bar)).toBe(900);
  });
});

describe('review fixes', () => {
  test('a right-to-left panel keeps its clamp', async () => {
    const { view } = mount(<T t={t} />);
    const toolbar = view.getByTestId('docx-toolbar');
    toolbar.setAttribute('dir', 'rtl');
    await measure(toolbar, 300);
    const trigger = view.getByLabelText('More');
    const rect = { left: 178, right: 212, top: 0, bottom: 34, width: 34, height: 34 } as DOMRect;
    trigger.getBoundingClientRect = () => rect;
    trigger.parentElement!.getBoundingClientRect = () => rect;
    await act(async () => {
      trigger.click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    // `inset-inline-end` maps to `left` in right-to-left text and would cancel the clamp.
    expect(panel.style.getPropertyValue('inset-inline-end')).toBe('');
    expect(panel.style.left).not.toBe('');
    expect(panel.style.right).toBe('auto');
  });

  test('labels render as written unless they are a catalog key with a string', async () => {
    const { view } = mount(
      <T>
        <T.Group id="a" label="Review {beta}">
          <T.Action label="A" />
        </T.Group>
        <T.Group id="b" label="formattingBar.groups">
          <T.Action label="B" />
        </T.Group>
        <T.Group id="c" label="formattingBar.groups.font">
          <T.Action label="C" />
        </T.Group>
      </T>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    expect(toolbar.querySelector('[data-toolbar-group="a"]')!.getAttribute('aria-label')).toBe(
      'Review {beta}'
    );
    // A key that names a branch of the catalog is not a label.
    expect(toolbar.querySelector('[data-toolbar-group="b"]')!.getAttribute('aria-label')).toBe(
      'formattingBar.groups'
    );
    // A key with a string in the catalogue resolves.
    expect(toolbar.querySelector('[data-toolbar-group="c"]')!.getAttribute('aria-label')).toBe(
      en.formattingBar.groups.font
    );
  });

  test('a host group whose children all render nothing is dropped', () => {
    const { view } = mount(
      <T>
        <T.Group id="empty" label="Empty">
          {false}
          {null}
        </T.Group>
      </T>
    );
    expect(
      view.getByTestId('docx-toolbar').querySelector('[data-toolbar-group="empty"]')
    ).toBeNull();
  });

  test('overflowContent on a built-in group renders without children', async () => {
    const { view } = mount(
      <T t={t}>
        <T.Group id="zoom" overflowContent={() => <span data-testid="zoom-extra" />} />
      </T>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    await measure(toolbar, 760);
    await act(async () => {
      view.getByLabelText('More').click();
    });
    expect(
      view.getByTestId('toolbar-overflow-panel').querySelector('[data-testid="zoom-extra"]')
    ).not.toBeNull();
  });

  test('the table grid closes the panel after an insert, and Escape closes it after a click', async () => {
    const { view, editor } = mount(
      <T t={t}>
        <T.Group id="ins" label="Insert">
          <T.TableInsert />
        </T.Group>
      </T>
    );
    await waitFor(() => expect(editor().surface).not.toBeNull());
    const toolbar = view.getByTestId('docx-toolbar');
    await measure(toolbar, 420);
    const openPanel = async () => {
      await act(async () => {
        view.getByLabelText('More').click();
      });
      return view.getByTestId('toolbar-overflow-panel');
    };
    let panel = await openPanel();
    let trigger = panel.querySelector<HTMLButtonElement>('[data-slot="table.insert"]')!;
    await waitFor(() => expect(trigger.disabled).toBe(false));
    await act(async () => {
      trigger.click();
    });
    // A pointer open moves focus into the grid, so its own handler sees Escape.
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement?.getAttribute('role')).toBe('gridcell');
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    });
    expect(panel.querySelector('[role="grid"]')).toBeNull();

    panel = view.queryByTestId('toolbar-overflow-panel') ?? (await openPanel());
    trigger = panel.querySelector<HTMLButtonElement>('[data-slot="table.insert"]')!;
    await act(async () => {
      trigger.click();
    });
    await act(async () => {
      fireEvent.click(panel.querySelector('[data-cell="2x2"]')!);
    });
    expect(view.queryByTestId('toolbar-overflow-panel')).toBeNull();
  });
});

describe('TableInsert', () => {
  test('a second click on the trigger closes the grid and focuses the document', async () => {
    const { view, editor } = mount(
      <T preset={false}>
        <T.TableInsert />
      </T>
    );
    await waitFor(() => expect(editor().surface).not.toBeNull());
    const trigger = view.container.querySelector<HTMLButtonElement>('[data-slot="table.insert"]')!;
    await waitFor(() => expect(trigger.disabled).toBe(false));
    const focus = mock(() => {});
    editor().focus = focus;
    await act(async () => {
      trigger.click();
    });
    expect(view.container.querySelector('[role="grid"]')).not.toBeNull();
    await act(async () => {
      trigger.click();
    });
    expect(view.container.querySelector('[role="grid"]')).toBeNull();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  test('opens a size grid and inserts the picked size', async () => {
    const { view, editor } = mount(
      <T preset={false}>
        <T.TableInsert />
      </T>
    );
    await waitFor(() => expect(editor().surface).not.toBeNull());
    const trigger = view.container.querySelector<HTMLButtonElement>('[data-slot="table.insert"]')!;
    await waitFor(() => expect(trigger.disabled).toBe(false));
    expect(trigger.getAttribute('aria-haspopup')).toBe('grid');
    await act(async () => {
      trigger.click();
    });
    const grid = view.container.querySelector('[role="grid"]')!;
    expect(grid.querySelectorAll('[role="gridcell"]').length).toBe(36);
    const exec = editor().exec.bind(editor());
    const calls: unknown[] = [];
    editor().exec = ((command: unknown) => {
      calls.push(command);
      return exec(command as never);
    }) as typeof exec;
    await act(async () => {
      fireEvent.click(grid.querySelector('[data-cell="2x3"]')!);
    });
    expect(calls).toContainEqual({ type: 'insertTable', rows: 2, cols: 3 });
    expect(view.container.querySelector('[role="grid"]')).toBeNull();
  });
});

function FakeRail({ onDraft }: { onDraft: () => void }) {
  const rail = useContext(ReviewRailContext);
  useEffect(() => rail?.register(), [rail?.register]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => rail?.registerCommentDraft(onDraft), [rail, onDraft]);
  return null;
}

describe('AddComment', () => {
  test('is disabled with the engine reason when no review module is registered', async () => {
    const { view, editor } = mount(
      <T preset={false}>
        <T.AddComment />
      </T>
    );
    await waitFor(() => expect(editor().surface).not.toBeNull());
    const button = view.container.querySelector<HTMLButtonElement>('[data-part="add-comment"]')!;
    expect(button.disabled).toBe(true);
    expect(button.title).not.toBe(en.common.comment);
  });

  test('requests a comment draft from the review rail', async () => {
    const onDraft = mock(() => {});
    const { view, editor } = mount(
      <T preset={false}>
        <T.AddComment />
      </T>,
      {
        modules: true,
        extra: <FakeRail onDraft={onDraft} />,
        // happy-dom lays nothing out, so the selection has no place on the page by itself.
        onReady: (instance) => {
          (instance as unknown as { getSelectionPlacement: () => unknown }).getSelectionPlacement =
            () => ({ anchorY: 10 });
        },
      }
    );
    await waitFor(() => expect(editor().surface).not.toBeNull());
    const paragraph = editor().surface!.session.paragraphIds()[0]!;
    await act(async () => {
      editor().surface!.setSelection({
        anchor: { paragraphId: paragraph, offset: 0 },
        head: { paragraphId: paragraph, offset: 5 },
      });
    });
    const button = view.container.querySelector<HTMLButtonElement>('[data-part="add-comment"]')!;
    await waitFor(() => expect(button.disabled).toBe(false));
    await act(async () => {
      button.click();
    });
    expect(onDraft).toHaveBeenCalledTimes(1);
  });
});

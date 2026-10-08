// The menu bar collapses menus that do not fit into one "⋯" menu, as submenus.
//
// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorMenu } from '../src/editor/menu/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const SOURCE = zipSync({
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
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>`
  ),
});

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

function mount(menu: ReactNode): ReturnType<typeof render> {
  return render(
    <DocxEditorRoot document={SOURCE}>
      {menu}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
}

async function measure(bar: HTMLElement, barWidth: number, menuWidth = 60): Promise<void> {
  Object.defineProperty(bar, 'clientWidth', { configurable: true, get: () => barWidth });
  for (const element of bar.querySelectorAll('[data-toolbar-group]')) {
    Object.defineProperty(element, 'offsetWidth', { configurable: true, get: () => menuWidth });
  }
  await act(async () => {
    for (const observer of [...MockResizeObserver.instances]) observer.flush();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

const triggers = (bar: HTMLElement) =>
  [...bar.querySelectorAll<HTMLElement>(':scope > [data-menu] > .docx-menubar__trigger')].map(
    (trigger) => trigger.closest('[data-menu]')!.getAttribute('data-menu')
  );

describe('menu bar overflow', () => {
  test('menus that do not fit move into one "⋯" menu, from the end', async () => {
    const view = mount(
      <DocxEditorMenu t={(key) => (key === 'formattingBar.more' ? 'More' : key)} />
    );
    const bar = view.getByTestId('docx-menubar');
    expect(bar.getAttribute('role')).toBe('menubar');
    expect(bar.hasAttribute('data-overflow')).toBe(true);
    await measure(bar, 2000);
    expect(triggers(bar)).toEqual(['file', 'format', 'insert', 'review', 'help']);

    await measure(bar, 220);
    expect(triggers(bar)).toEqual(['file', 'format', 'insert', 'docx-menubar-more']);
    const more = view.getByLabelText('More');
    expect(more.getAttribute('role')).toBe('menuitem');
    expect(more.getAttribute('aria-haspopup')).toBe('menu');

    // Keyboard: the bar's arrows reach the "⋯" trigger, and ArrowDown opens it.
    const file = bar.querySelector<HTMLElement>('[data-menu="file"] > .docx-menubar__trigger')!;
    file.focus();
    await act(async () => {
      fireEvent.keyDown(file, { key: 'ArrowLeft' });
    });
    expect(document.activeElement).toBe(more);
    await act(async () => {
      fireEvent.keyDown(more, { key: 'ArrowDown' });
    });
    const panel = bar.querySelector<HTMLElement>(
      '[data-menu="docx-menubar-more"] > [role="menu"]'
    )!;
    const rows = [
      ...panel.querySelectorAll<HTMLElement>(':scope > [role="none"] > [role="menuitem"]'),
    ];
    expect(rows.map((row) => row.getAttribute('aria-haspopup'))).toEqual(['menu', 'menu']);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('toolbar.review'),
      expect.stringContaining('toolbar.help'),
    ]);
    // The first row has focus, and ArrowRight opens its submenu with the menu's own rows.
    expect(document.activeElement).toBe(rows[0]);
    await act(async () => {
      fireEvent.keyDown(rows[0]!, { key: 'ArrowRight' });
    });
    const submenu = panel.querySelector('.docx-menubar__submenu-panel');
    expect(submenu?.querySelector('[data-slot="review.allMarkup"]')).not.toBeNull();

    // Room again: every menu comes back and the "⋯" menu goes away.
    await measure(bar, 2000);
    expect(triggers(bar)).toEqual(['file', 'format', 'insert', 'review', 'help']);
  });

  test('overflow={false} wraps and does not measure', () => {
    const view = mount(<DocxEditorMenu overflow={false} />);
    const bar = view.getByTestId('docx-menubar');
    expect(bar.hasAttribute('data-overflow')).toBe(false);
    expect(bar.querySelector('[data-toolbar-group]')).toBeNull();
  });
});

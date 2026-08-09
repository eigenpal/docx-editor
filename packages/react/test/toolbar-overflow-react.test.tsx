// Responsive toolbar overflow: measured one-row collapse, More dialog, and opt-outs.
//
// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';
import { LocaleProvider } from '../src/i18n/index.ts';
import { en, type Translations } from '@docx-editor.dev/i18n';

/** Every leaf key in the shipped catalogue, dotted. */
const catalogueKeys = new Set<string>(
  (function walk(node: Record<string, unknown>, path: string, out: string[]): string[] {
    for (const [key, value] of Object.entries(node)) {
      const next = path ? `${path}.${key}` : key;
      if (value && typeof value === 'object') walk(value as Record<string, unknown>, next, out);
      else out.push(next);
    }
    return out;
  })(en as unknown as Record<string, unknown>, '', [])
);

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

/** Shared ResizeObserver harness for overflow measurement tests in this file only. */
class MockResizeObserver {
  static readonly instances: MockResizeObserver[] = [];
  private readonly callback: ResizeObserverCallback;
  readonly observed: Element[] = [];

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

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

/** Same selector as `focusFirstInteractive` in ToolbarOverflow.tsx. */
const OVERFLOW_FIRST_INTERACTIVE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function installResizeObserverMock(): void {
  MockResizeObserver.instances.length = 0;
  global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
}

function mockBarGeometry(
  toolbar: HTMLElement,
  options: { barWidth: number; groupWidth: number; fixedWidth?: number }
): void {
  toolbar.style.width = `${options.barWidth}px`;
  toolbar.style.boxSizing = 'border-box';
  Object.defineProperty(toolbar, 'clientWidth', {
    configurable: true,
    get: () => options.barWidth,
  });
  for (const group of toolbar.querySelectorAll('[data-toolbar-group]')) {
    const width = options.groupWidth;
    Object.defineProperty(group, 'offsetWidth', { configurable: true, get: () => width });
  }
  for (const fixed of toolbar.querySelectorAll('[data-toolbar-fixed]')) {
    const width = options.fixedWidth ?? options.groupWidth;
    Object.defineProperty(fixed, 'offsetWidth', { configurable: true, get: () => width });
  }
  const separator = toolbar.querySelector('.docx-toolbar__separator');
  if (separator) {
    Object.defineProperty(separator, 'offsetWidth', { configurable: true, get: () => 1 });
  }
}

async function collapseToolbar(
  view: ReturnType<typeof render>,
  options: { barWidth: number; groupWidth?: number; fixedWidth?: number } = {
    barWidth: 280,
    groupWidth: 90,
    fixedWidth: 140,
  }
): Promise<HTMLElement> {
  const toolbar = view.getByTestId('docx-toolbar');
  mockBarGeometry(toolbar, {
    barWidth: options.barWidth,
    groupWidth: options.groupWidth ?? 90,
    fixedWidth: options.fixedWidth ?? 140,
  });
  await act(async () => {
    for (const observer of MockResizeObserver.instances) observer.flush();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
  return toolbar;
}

function mountToolbar(
  toolbar: ReactNode,
  source: Uint8Array = SOURCE
): { view: ReturnType<typeof render>; editor: () => DocxEditorInstance } {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      {toolbar}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

beforeEach(() => {
  MockResizeObserver.instances.length = 0;
});

afterEach(() => {
  cleanup();
  global.ResizeObserver = RealResizeObserver;
});

describe('toolbar overflow integration', () => {
  test('overflow={false} keeps wrapping and does not measure', () => {
    const { view } = mountToolbar(<DocxEditorToolbar overflow={false} />);
    const toolbar = view.getByTestId('docx-toolbar');
    expect(toolbar.hasAttribute('data-overflow')).toBe(false);
    expect(view.queryByLabelText('formattingBar.more')).toBeNull();
    expect(MockResizeObserver.instances.length).toBe(0);
  });

  test('preset={false} renders verbatim markup without group wrappers or measurement', () => {
    const { view } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.Bold />
        <DocxEditorToolbar.Undo />
      </DocxEditorToolbar>
    );
    const toolbar = view.getByTestId('docx-toolbar');
    expect(toolbar.querySelector('.docx-toolbar__group')).toBeNull();
    expect(toolbar.hasAttribute('data-overflow')).toBe(false);
    expect(MockResizeObserver.instances.length).toBe(0);
  });

  test('collapses groups into More in collapse order and keeps review pinned', async () => {
    installResizeObserverMock();
    const { view } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)} />
    );
    const toolbar = await collapseToolbar(view, { barWidth: 360 });

    expect(
      MockResizeObserver.instances.some((observer) =>
        observer.observed.some((element) => element.hasAttribute('data-toolbar-fixed'))
      )
    ).toBe(true);
    expect(toolbar.querySelector('[data-slot="zoom.level"]')).toBeNull();
    expect(toolbar.querySelector('[data-slot="review.comments"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-slot="review.editingMode"]')).not.toBeNull();

    const trigger = view.getByLabelText('More');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await act(async () => {
      trigger.click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.hasAttribute('aria-modal')).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(panel.querySelector('[data-slot="zoom.level"]')).not.toBeNull();
    expect(
      panel.querySelector('[role="group"][aria-label="formattingBar.groups.zoom"]')
    ).not.toBeNull();
    expect(panel.querySelector('[role="menuitem"]')).toBeNull();
    expect(panel.querySelector('.docx-toolbar__more-command')).not.toBeNull();
  });

  test('value rows in the panel label from the catalogue, and a provider localizes them', async () => {
    installResizeObserverMock();
    // No host `t`: the value rows (zoom, line spacing, pickers) resolved to raw keys while
    // every command row beside them read as English.
    const { view } = mountToolbar(<DocxEditorToolbar />);
    await collapseToolbar(view, { barWidth: 360 });

    await act(async () => {
      view.getByLabelText('More').click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    const labels = Array.from(panel.querySelectorAll('.docx-toolbar__more-control-label')).map(
      (node) => node.textContent
    );
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).toContain('Zoom');
    // No label IS a catalogue key. Asserted against the real catalogue rather than
    // "contains no dot", which would false-fail on the first label ending in a period.
    for (const text of labels) expect(catalogueKeys.has(text ?? '')).toBe(false);
    cleanup();

    const de = { _lang: 'de', formattingBar: { groups: { zoom: 'Zoomen' } } } as Translations;
    const localized = mountToolbar(
      <LocaleProvider i18n={de}>
        <DocxEditorToolbar />
      </LocaleProvider>
    ).view;
    await collapseToolbar(localized, { barWidth: 360 });
    await act(async () => {
      localized.getByLabelText('More').click();
    });
    const localizedLabels = Array.from(
      localized
        .getByTestId('toolbar-overflow-panel')
        .querySelectorAll('.docx-toolbar__more-control-label')
    ).map((node) => node.textContent);
    expect(localizedLabels).toContain('Zoomen');
    // A key the locale leaves out falls through to English, not to the raw key.
    expect(localizedLabels).toContain('Line spacing');
  });

  test('More dialog closes on Escape, outside click, and command selection', async () => {
    installResizeObserverMock();
    const { view } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)} />
    );
    await collapseToolbar(view, { barWidth: 280 });

    const trigger = view.getByLabelText('More') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });
    expect(view.queryByTestId('toolbar-overflow-panel')).not.toBeNull();

    await act(async () => {
      fireEvent.keyDown(view.getByTestId('toolbar-overflow-panel'), { key: 'Escape' });
    });
    expect(view.queryByTestId('toolbar-overflow-panel')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await act(async () => {
      trigger.click();
    });
    await act(async () => {
      fireEvent.mouseDown(document.body, { bubbles: true });
    });
    expect(view.queryByTestId('toolbar-overflow-panel')).toBeNull();
  });

  test('a command in the overflow dialog executes through shared engine state', async () => {
    installResizeObserverMock();
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)} />
    );
    await waitFor(() => {
      expect(editor().surface).not.toBeNull();
    });
    await act(async () => {
      editor().surface!.selectAll();
    });

    const toolbar = await collapseToolbar(view, { barWidth: 240 });

    const trigger = view.getByLabelText('More');
    expect(toolbar.querySelector('[data-slot="text.bold"]')).toBeNull();
    await act(async () => {
      trigger.click();
    });

    const bold = view.container.querySelector(
      '[data-testid="toolbar-overflow-panel"] [data-slot="text.bold"]'
    ) as HTMLButtonElement;
    expect(bold.className).toContain('docx-toolbar__more-command');
    expect(bold.getAttribute('role')).toBeNull();
    expect(bold.disabled).toBe(false);

    await act(async () => {
      bold.click();
    });
    expect(editor().snapshot().formatting?.bold).toBe(true);
    expect(view.queryByTestId('toolbar-overflow-panel')).toBeNull();
  });

  test('hidden override is absent when its group collapses into More', async () => {
    installResizeObserverMock();
    const { view } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)}>
        <DocxEditorToolbar.Strike hidden />
      </DocxEditorToolbar>
    );
    await collapseToolbar(view, { barWidth: 240 });

    await act(async () => {
      view.getByLabelText('More').click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    expect(panel.querySelector('[data-slot="text.strike"]')).toBeNull();
    expect(panel.querySelector('[aria-label="formattingBar.strikethrough"]')).toBeNull();
  });

  test('ArrowDown on the trigger opens the dialog and focuses the first control', async () => {
    installResizeObserverMock();
    const { view } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)} />
    );
    await collapseToolbar(view, { barWidth: 280 });

    const trigger = view.getByLabelText('More') as HTMLButtonElement;
    await act(async () => {
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    });

    const panel = view.getByTestId('toolbar-overflow-panel');
    const firstControl = panel.querySelector<HTMLElement>(OVERFLOW_FIRST_INTERACTIVE);
    expect(firstControl).not.toBeNull();
    await waitFor(() => {
      const active = document.activeElement;
      expect(active).not.toBeNull();
      expect(active).not.toBe(trigger);
      expect(panel.contains(active)).toBe(true);
      expect(active instanceof HTMLElement && active.matches(OVERFLOW_FIRST_INTERACTIVE)).toBe(
        true
      );
      expect(
        Array.from(panel.querySelectorAll<HTMLElement>(OVERFLOW_FIRST_INTERACTIVE)).indexOf(
          active as HTMLElement
        )
      ).toBe(0);
    });
  });

  test('ArrowDown inside a value control is not hijacked by the dialog', async () => {
    installResizeObserverMock();
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar t={(key) => (key === 'formattingBar.more' ? 'More' : key)} />
    );
    await waitFor(() => {
      expect(view.container.querySelectorAll('.docx-page').length).toBeGreaterThan(0);
    });
    await act(async () => {
      editor().surface!.selectAll();
    });
    await collapseToolbar(view, { barWidth: 200, groupWidth: 100, fixedWidth: 160 });

    await act(async () => {
      view.getByLabelText('More').click();
    });
    const panel = view.getByTestId('toolbar-overflow-panel');
    const fontTrigger = panel.querySelector(
      '.docx-toolbar__font-family-trigger'
    ) as HTMLButtonElement;
    expect(fontTrigger).not.toBeNull();
    fontTrigger.focus();

    let defaultPrevented = false;
    await act(async () => {
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      });
      event.preventDefault = () => {
        defaultPrevented = true;
      };
      fontTrigger.dispatchEvent(event);
    });
    expect(defaultPrevented).toBe(false);
  });

  test('the overflow panel uses viewport-bounded logical sizing', () => {
    const css = readFileSync(new URL('../../core/src/styles/editor.css', import.meta.url), 'utf8');
    const rule = css.match(/\.docx-toolbar__more-panel\s*\{[^}]+\}/)?.[0] ?? '';
    expect(rule).toContain('box-sizing: border-box');
    expect(rule).toContain('inline-size: min(340px, calc(100vw - 16px))');
    expect(rule).toContain('min-inline-size: min(260px, calc(100vw - 16px))');
    expect(rule).toContain('max-height: min(72vh, 560px)');
  });

  test('More and its nested Zoom picker are not clipped by overflow containers', () => {
    const coreCss = readFileSync(
      new URL('../../core/src/styles/editor.css', import.meta.url),
      'utf8'
    );
    const nestedMenuRule =
      coreCss.match(
        /\.docx-toolbar__more-panel:has\(\.docx-toolbar__zoom-menu\)\s*\{[^}]+\}/
      )?.[0] ?? '';
    expect(nestedMenuRule).toContain('overflow-y: visible');

    const demoCss = readFileSync(
      new URL('../../../examples/vite/src/styles.css', import.meta.url),
      'utf8'
    );
    const mobileToolbarRule =
      demoCss.match(
        /@media \(max-width: 768px\)\s*\{[\s\S]*?\.docx-editor \[role='toolbar'\]\s*\{[^}]+\}/
      )?.[0] ?? '';
    expect(mobileToolbarRule).not.toContain('overflow');
  });
});

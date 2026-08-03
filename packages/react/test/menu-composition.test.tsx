// The compound menu bar (registry-derived default + in-place overrides + the rows whose
// dispatch is not a command).
//
// Against the REAL engine, like toolbar-composition.test.tsx: a mounted document, painted
// pages, committed ops. What these pin down: the bar IS `CHROME_MENUS` in registry order
// (derived here too, so a registry change updates the expectation); one panel open at a
// time; that a menu child REPLACES its menu in place and `hidden` removes it;
// `preset={false}` verbatim rendering; that a WIRED row commits through the engine and
// closes the bar; that an UNWIRED row renders present-and-disabled carrying the ENGINE's
// reason rather than an adapter paraphrase; that open/save fall back to packaged
// behaviour and honour a host override; and the caret-preserving mousedown contract.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { CHROME_MENUS, type DocxEditorInstance } from '@docx-editor.dev/core-contract/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorMenu } from '../src/editor/menu/index.ts';

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

/** The bar's menus, DERIVED from the registry exactly as the component derives them. */
const EXPECTED_MENUS: readonly string[] = CHROME_MENUS.map((menu) => menu.id);

function mountMenu(
  menu: ReactNode,
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
      {menu}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

function bar(view: ReturnType<typeof render>): HTMLElement {
  return view.getByTestId('docx-menubar');
}

/** The bar's menu identities, in order. */
function menuIds(element: HTMLElement): string[] {
  return [...element.children].map(
    (child) => child.getAttribute('data-menu') ?? child.getAttribute('data-testid') ?? 'other'
  );
}

/** Open one menu by its trigger's visible label (the raw i18n key without a `t`). */
function openMenu(view: ReturnType<typeof render>, labelKey: string): void {
  const match = [...view.container.querySelectorAll<HTMLButtonElement>('.docx-menubar__trigger')] //
    .find((button) => button.textContent === labelKey);
  if (!match) throw new Error(`no trigger labelled ${labelKey}`);
  act(() => {
    fireEvent.click(match);
  });
}

/** Reveal a submenu's panel — the parent opens on hover, as it does for a pointer. */
function openSubmenu(view: ReturnType<typeof render>, labelKey: string): void {
  const parent = [...view.container.querySelectorAll<HTMLElement>('.docx-menubar__submenu')] //
    .find((element) => element.textContent?.includes(labelKey));
  if (!parent) throw new Error(`no submenu labelled ${labelKey}`);
  act(() => {
    fireEvent.mouseEnter(parent);
  });
}

function row(view: ReturnType<typeof render>, slot: string): HTMLButtonElement {
  const element = view.container.querySelector<HTMLButtonElement>(`[data-slot="${slot}"]`);
  if (!element) throw new Error(`no row for ${slot}`);
  return element;
}

afterEach(() => {
  cleanup();
});

describe('the default bar', () => {
  test('renders every registry menu, in registry order', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    expect(menuIds(bar(view))).toEqual([...EXPECTED_MENUS]);
    // Closed: a panel exists only while its menu is open.
    expect(view.container.querySelectorAll('.docx-menubar__menu').length).toBe(0);
  });

  test('one panel at a time — opening a second menu closes the first', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    openMenu(view, 'toolbar.file');
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(1);
    expect(row(view, 'file.open')).toBeDefined();

    openMenu(view, 'toolbar.insert');
    expect(view.container.querySelector('[data-slot="file.open"]')).toBeNull();
    expect(row(view, 'image.insert')).toBeDefined();

    // A second click on the open menu's trigger closes it.
    openMenu(view, 'toolbar.insert');
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(0);
  });

  test('the File menu is Open · Save · Page setup, and never Print', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    openMenu(view, 'toolbar.file');
    const slots = [...view.container.querySelectorAll('[role="menu"] [data-slot]')].map((element) =>
      element.getAttribute('data-slot')
    );
    expect(slots).toEqual(['file.open', 'file.save', 'file.pageSetup']);
    expect(view.container.textContent).not.toContain('toolbar.print');
  });

  test('a menu child overrides its menu IN PLACE; `hidden` removes it', () => {
    const { view } = mountMenu(
      <DocxEditorMenu>
        <DocxEditorMenu.Help hidden />
        <DocxEditorMenu.File className="custom-file" />
      </DocxEditorMenu>
    );
    // Same order, File still in first position, Help gone.
    expect(menuIds(bar(view))).toEqual(['file', 'format', 'insert']);
    expect(view.container.querySelector('.custom-file')).not.toBeNull();
  });

  test('`preset={false}` renders children verbatim', () => {
    const { view } = mountMenu(
      <DocxEditorMenu preset={false}>
        <DocxEditorMenu.Insert />
      </DocxEditorMenu>
    );
    expect(menuIds(bar(view))).toEqual(['insert']);
  });
});

describe('rows carry the engine, not a paraphrase', () => {
  test('a WIRED row commits through the engine and closes the bar', async () => {
    const { view, editor } = mountMenu(<DocxEditorMenu />);
    await act(async () => {
      await Promise.resolve();
    });
    const before = editor().snapshot().page.total;

    openMenu(view, 'toolbar.insert');
    // Page break lives in the Break submenu, which opens under the pointer.
    openSubmenu(view, 'toolbar.break');
    const pageBreak = row(view, 'insert.pageBreak');
    expect(pageBreak.disabled).toBe(false);
    act(() => {
      fireEvent.click(pageBreak);
    });

    // A hard page break really paginates: the document grew a page, and the edit is on
    // the undo stack. Asserting the OUTCOME, not that a handler ran.
    expect(editor().snapshot().page.total).toBe(before + 1);
    expect(editor().snapshot().canUndo).toBe(true);
    // Selecting a row closes the bar.
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(0);
  });

  test('an UNWIRED row is present, disabled, and quotes the ENGINE', async () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    await act(async () => {
      await Promise.resolve();
    });
    openMenu(view, 'toolbar.insert');

    // Table of contents has no command in the tree editor yet. Present — dropping it
    // would understate the gap — disabled, and its tooltip is the engine's own words.
    const toc = row(view, 'insert.toc');
    expect(toc.disabled).toBe(true);
    expect(toc.getAttribute('title')).toBe('not wired to an editor command');
    // The label is still the registry's, so the row reads as itself.
    expect(toc.textContent).toContain('toolbar.tableOfContents');

    // Same treatment inside the submenu: the continuous section break is a real Word
    // choice the engine cannot express, so it is shown and refused rather than dropped.
    openSubmenu(view, 'toolbar.break');
    expect(row(view, 'insert.sectionBreakContinuous').disabled).toBe(true);
    expect(row(view, 'insert.sectionBreakNextPage').disabled).toBe(false);
  });

  test('Open and Save work with no configuration at all', async () => {
    // The packaged defaults: a picker into `Editor.load`, and `Editor.save()` into a
    // download. Both need only an editor, so neither row waits on a host prop.
    const { view } = mountMenu(<DocxEditorMenu />);
    await act(async () => {
      await Promise.resolve();
    });
    openMenu(view, 'toolbar.file');
    expect(row(view, 'file.open').disabled).toBe(false);
    expect(row(view, 'file.save').disabled).toBe(false);
    expect(row(view, 'file.pageSetup').disabled).toBe(false);
    // The shortcut column is filled from the registry's keys.
    expect(row(view, 'file.save').textContent).toContain('toolbar.saveShortcut');
  });

  test('a host `onSave` replaces the packaged download', async () => {
    let saved = 0;
    const { view } = mountMenu(<DocxEditorMenu onSave={() => (saved += 1)} />);
    await act(async () => {
      await Promise.resolve();
    });
    openMenu(view, 'toolbar.file');
    act(() => {
      fireEvent.click(row(view, 'file.save'));
    });
    expect(saved).toBe(1);
  });

  test('a host `onOpen` replaces the packaged file picker', async () => {
    let opened = 0;
    const { view } = mountMenu(<DocxEditorMenu onOpen={() => (opened += 1)} />);
    await act(async () => {
      await Promise.resolve();
    });
    openMenu(view, 'toolbar.file');
    act(() => {
      fireEvent.click(row(view, 'file.open'));
    });
    expect(opened).toBe(1);
  });
});

describe('chrome contracts', () => {
  test('mousedown on the bar is prevented, so the caret does not move', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    bar(view).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  test('labels resolve through `t`, and fall back to the KEY, never to English', () => {
    const { view } = mountMenu(<DocxEditorMenu t={(key) => `[${key}]`} />);
    expect(view.container.textContent).toContain('[toolbar.file]');
    expect(view.container.textContent).toContain('[toolbar.insert]');

    cleanup();
    const bare = mountMenu(<DocxEditorMenu />);
    expect(bare.view.container.textContent).toContain('toolbar.file');
    expect(bare.view.container.textContent).not.toContain('File');
  });

  test('`<DocxEditor>` mounts the bar by default, and `menu={false}` removes it', () => {
    const withMenu = render(<DocxEditor document={SOURCE} />);
    expect(withMenu.queryByTestId('docx-menubar')).not.toBeNull();
    // Packaged chrome resolves labels through the bundled catalogue, not the raw key.
    expect(withMenu.container.textContent).toContain('Insert');
    cleanup();

    const without = render(<DocxEditor document={SOURCE} menu={false} />);
    expect(without.queryByTestId('docx-menubar')).toBeNull();
    // The toolbar is untouched by the menu toggle.
    expect(without.queryByTestId('docx-toolbar')).not.toBeNull();
  });

  test('hovering to a different trigger then clicking it KEEPS that menu open', () => {
    // The bar tracks the pointer once something is open, so by the time the click lands
    // the state already says "open" — a plain toggle closed the menu the user had just
    // clicked on, which reads as the bar closing on them.
    const { view } = mountMenu(<DocxEditorMenu />);
    openMenu(view, 'toolbar.file');
    const insert = [...view.container.querySelectorAll<HTMLButtonElement>('.docx-menubar__trigger')] //
      .find((button) => button.textContent === 'toolbar.insert')!;
    act(() => {
      fireEvent.mouseEnter(insert);
    });
    expect(insert.getAttribute('aria-expanded')).toBe('true');
    act(() => {
      fireEvent.click(insert);
    });
    expect(insert.getAttribute('aria-expanded')).toBe('true');
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(1);

    // A click on the menu that is ALREADY open still closes it.
    act(() => {
      fireEvent.click(insert);
    });
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(0);
  });

  test('clicking a submenu parent the pointer already opened keeps it open', () => {
    // Same class of bug one level down: `onMouseEnter` opened the panel, so a toggling
    // click closed it — and no further mouseEnter fires while the pointer sits still.
    const { view } = mountMenu(<DocxEditorMenu />);
    openMenu(view, 'toolbar.insert');
    openSubmenu(view, 'toolbar.break');
    expect(row(view, 'insert.pageBreak')).toBeDefined();
    const parent = [...view.container.querySelectorAll<HTMLElement>('.docx-menubar__submenu')] //
      .find((element) => element.textContent?.includes('toolbar.break'))!;
    act(() => {
      fireEvent.click(parent.querySelector('button')!);
    });
    expect(view.container.querySelector('[data-slot="insert.pageBreak"]')).not.toBeNull();
  });

  test('a submenu opened by keyboard focus closes when focus leaves it', () => {
    // `onMouseLeave` cannot fire for a pointer that never arrived, so a tab-opened panel
    // used to float over the rows below it until the whole bar closed.
    const { view } = mountMenu(<DocxEditorMenu />);
    openMenu(view, 'toolbar.insert');
    const parent = [...view.container.querySelectorAll<HTMLElement>('.docx-menubar__submenu')] //
      .find((element) => element.textContent?.includes('toolbar.break'))!;
    act(() => {
      fireEvent.focus(parent.querySelector('button')!);
    });
    expect(view.container.querySelector('[data-slot="insert.pageBreak"]')).not.toBeNull();
    act(() => {
      fireEvent.blur(parent.querySelector('button')!, { relatedTarget: document.body });
    });
    expect(view.container.querySelector('[data-slot="insert.pageBreak"]')).toBeNull();
  });

  test('Ctrl/Cmd+S is scoped to this editor, not to the whole document', async () => {
    let saved = 0;
    const { view } = mountMenu(<DocxEditorMenu onSave={() => (saved += 1)} />);
    await act(async () => {
      await Promise.resolve();
    });

    // A field elsewhere on the host page: outside the editor root entirely.
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    act(() => {
      fireEvent.keyDown(outside, { key: 's', ctrlKey: true });
    });
    expect(saved).toBe(0);

    // Inside the editor, the shortcut works.
    act(() => {
      fireEvent.keyDown(bar(view), { key: 's', ctrlKey: true });
    });
    expect(saved).toBe(1);
    outside.remove();
  });

  test('Help › Report issue is addressable: `reportIssue={false}` drops it and Help', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    expect(menuIds(bar(view))).toContain('help');
    cleanup();

    // The one packaged row that reaches OUTSIDE the host's product, so a host must be able
    // to remove it without giving up the bar.
    const dropped = mountMenu(<DocxEditorMenu reportIssue={false} />);
    expect(menuIds(bar(dropped.view))).not.toContain('help');
  });

  test('`onReportIssue` redirects the row at the host, without replacing the menu', () => {
    let reported = 0;
    const { view } = mountMenu(<DocxEditorMenu onReportIssue={() => (reported += 1)} />);
    openMenu(view, 'toolbar.help');
    act(() => {
      fireEvent.click(view.container.querySelector<HTMLButtonElement>('[data-slot="help.reportIssue"]')!);
    });
    expect(reported).toBe(1);
  });

  test('`<DocxEditor menu={{...}}>` forwards menu props instead of forcing menu={false}', () => {
    const view = render(<DocxEditor document={SOURCE} menu={{ reportIssue: false }} />);
    expect(view.queryByTestId('docx-menubar')).not.toBeNull();
    expect(view.container.querySelector('[data-menu="help"]')).toBeNull();
    // The rest of the bar is untouched.
    expect(view.container.querySelector('[data-menu="insert"]')).not.toBeNull();
  });

  test('Escape closes the open menu', () => {
    const { view } = mountMenu(<DocxEditorMenu />);
    openMenu(view, 'toolbar.file');
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(1);
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(view.container.querySelectorAll('[role="menu"]').length).toBe(0);
  });
});

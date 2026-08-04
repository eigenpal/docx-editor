// The compound context menu: opening, the default set, in-place overrides, the keyboard,
// and the enabled state each row derives from the engine.
//
// Against the REAL engine, like menu-composition.test.tsx: a mounted document, painted
// pages, committed ops. What these pin down: right-click opens the panel and suppresses the
// browser's own; the rows ARE the menu bar's rows (so the disabled treatment has one
// definition); a row child REPLACES its row in place and `hidden` removes it;
// `preset={false}` renders verbatim; Cut and Copy carry the ENGINE's reason when nothing is
// selected; a row commits through the engine and closes the panel; and every close path
// actually closes.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core-contract/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { ContextMenu } from '../src/editor/contextmenu/index.ts';

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

/** Resolve the packaged keys to themselves, so a row's label is its key in assertions. */
const t = (key: string): string => key;

function mount(menu?: ReactNode): {
  view: ReturnType<typeof render>;
  editor: () => DocxEditorInstance;
} {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={SOURCE}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        {menu ?? <ContextMenu t={t} />}
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

function surface(view: ReturnType<typeof render>): HTMLElement {
  const element = view.container.querySelector<HTMLElement>('.docx-paginated-surface');
  if (!element) throw new Error('no painted surface');
  return element;
}

function panel(view: ReturnType<typeof render>): HTMLElement | null {
  return view.container.querySelector<HTMLElement>('.docx-contextmenu');
}

/** Right-click the painted surface at a point. */
function rightClick(view: ReturnType<typeof render>, x = 120, y = 140): void {
  act(() => {
    fireEvent.contextMenu(surface(view), { clientX: x, clientY: y, button: 2 });
  });
}

// The same three roles `panelItems` walks: a row that TOGGLES is a `menuitemcheckbox` and
// one of a mutually exclusive set is a `menuitemradio`, so keying only on `menuitem` would
// silently miss every slot-bound row that carries state.
const ROW_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

function rows(view: ReturnType<typeof render>): HTMLElement[] {
  const open = panel(view);
  return open ? [...open.querySelectorAll<HTMLElement>(ROW_SELECTOR)] : [];
}

function rowNamed(view: ReturnType<typeof render>, slot: string): HTMLElement {
  const element = panel(view)?.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  if (!element) throw new Error(`no row for ${slot}`);
  return element;
}

/** Select `[start, end)` of the first paragraph through the surface. */
function select(editor: DocxEditorInstance, start: number, end: number): void {
  const paragraph = editor.surface!.session.paragraphIds()[0]!;
  act(() => {
    editor.surface!.setSelection({
      anchor: { paragraphId: paragraph, offset: start },
      head: { paragraphId: paragraph, offset: end },
    });
  });
}

let written: string[] = [];

beforeEach(() => {
  written = [];
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: {
      writeText: async (text: string) => {
        written.push(text);
      },
      readText: async () => 'pasted',
    },
    configurable: true,
  });
});

afterEach(cleanup);

describe('opening', () => {
  test('right-click opens the panel and suppresses the browser menu', () => {
    const { view } = mount();
    expect(panel(view)).toBeNull();

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100,
    });
    act(() => {
      surface(view).dispatchEvent(event);
    });

    expect(panel(view)).not.toBeNull();
    expect(event.defaultPrevented).toBe(true);
  });

  test('the default set is the packaged rows, in order', () => {
    const { view } = mount();
    rightClick(view);

    expect(rows(view).map((row) => row.dataset.slot)).toEqual([
      'edit.cut',
      'edit.copy',
      'edit.paste',
      'edit.delete',
      'edit.selectAll',
      'text.link',
      'review.comments',
    ]);
  });

  test('disabled={true} leaves the browser menu alone', () => {
    const { view } = mount(<ContextMenu t={t} disabled />);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => {
      surface(view).dispatchEvent(event);
    });

    expect(panel(view)).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  // TRANSITIONS only. It used to announce `false` on mount, before the menu had ever
  // existed, and to re-announce on every unrelated parent render because the handler sat in
  // the effect's dependency array.
  test('onOpenChange reports transitions, and nothing on mount', () => {
    const seen: boolean[] = [];
    const { view } = mount(<ContextMenu t={t} onOpenChange={(open) => seen.push(open)} />);
    expect(seen).toEqual([]);

    rightClick(view);
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(seen).toEqual([true, false]);
  });

  test('disabled flipping true closes an OPEN panel', () => {
    const view = render(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorViewport>
          <DocxEditorContent />
          <ContextMenu t={t} />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    act(() => {
      fireEvent.contextMenu(surface(view), { clientX: 120, clientY: 140 });
    });
    expect(panel(view)).not.toBeNull();

    view.rerender(
      <DocxEditorRoot document={SOURCE}>
        <DocxEditorViewport>
          <DocxEditorContent />
          <ContextMenu t={t} disabled />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );

    expect(panel(view)).toBeNull();
    cleanup();
  });

  // The scroller, not the painted surface: the page is centred inside the scroller with a
  // margin, so a right-click in the grey gutter originates on the scroller and would never
  // reach a listener bound further in.
  test('opens from a right-click in the margin beside the page', () => {
    const { view } = mount();
    const scroller = view.container.querySelector<HTMLElement>('.docx-editor__scroll-container')!;
    act(() => {
      fireEvent.contextMenu(scroller, { clientX: 8, clientY: 300 });
    });

    expect(panel(view)).not.toBeNull();
  });

  test('the panel is labelled through t, not in hardcoded English', () => {
    const { view } = mount();
    rightClick(view);

    expect(panel(view)!.getAttribute('aria-label')).toBe('contextMenu.ariaLabel');
  });
});

describe('enabled state comes from the engine', () => {
  test('cut and copy are disabled at a collapsed caret, with the engine reason', () => {
    const { view } = mount();
    rightClick(view);

    for (const slot of ['edit.cut', 'edit.copy']) {
      const row = rowNamed(view, slot);
      expect(row.getAttribute('aria-disabled')).toBe('true');
      // The ENGINE's words, not an adapter paraphrase.
      expect(row.getAttribute('title')).toBe('nothing is selected');
    }
  });

  test('cut and copy enable once there is a selection', () => {
    const { view, editor } = mount();
    select(editor(), 0, 5);
    rightClick(view);

    expect(rowNamed(view, 'edit.cut').getAttribute('aria-disabled')).toBeNull();
    expect(rowNamed(view, 'edit.copy').getAttribute('aria-disabled')).toBeNull();
  });

  // A disabled row stays FOCUSABLE and keeps its reason reachable — the whole point of
  // `aria-disabled` over the native attribute.
  test('a disabled row is still in the panel and still announces its reason', () => {
    const { view } = mount();
    rightClick(view);
    const row = rowNamed(view, 'edit.cut');

    expect(row.hasAttribute('disabled')).toBe(false);
    expect(row.getAttribute('aria-describedby')).not.toBeNull();
  });
});

describe('rows act through the engine', () => {
  test('Copy writes the selection and closes the panel', () => {
    const { view, editor } = mount();
    select(editor(), 0, 5);
    rightClick(view);

    act(() => {
      fireEvent.click(rowNamed(view, 'edit.copy'));
    });

    expect(written).toEqual(['hello']);
    expect(panel(view)).toBeNull();
  });

  test('Select All selects the body', () => {
    const { view, editor } = mount();
    rightClick(view);

    act(() => {
      fireEvent.click(rowNamed(view, 'edit.selectAll'));
    });

    expect(editor().surface!.selectedText()).toContain('hello world');
  });

  test('Cut removes the selected text', () => {
    const { view, editor } = mount();
    select(editor(), 0, 6);
    rightClick(view);

    act(() => {
      fireEvent.click(rowNamed(view, 'edit.cut'));
    });

    expect(editor().query({ type: 'selectedText' })).toBe('');
    expect(written).toEqual(['hello ']);
  });

  test('a disabled row does nothing when clicked', () => {
    const { view } = mount();
    rightClick(view);

    act(() => {
      fireEvent.click(rowNamed(view, 'edit.cut'));
    });

    expect(written).toEqual([]);
    // Still open: a dead row must not behave like a live one that closed.
    expect(panel(view)).not.toBeNull();
  });

  // The caret guard is the reason `Item` exists as a component: a row that lets mousedown
  // through moves the selection out from under the action it is about to run.
  test('mousedown on a row is prevented', () => {
    const { view } = mount();
    rightClick(view);
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => {
      rowNamed(view, 'edit.copy').dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
  });
});

describe('composition', () => {
  test('a row child replaces its row in place', () => {
    const { view } = mount(
      <ContextMenu t={t}>
        <ContextMenu.Cut labelKey="igloo.carve" />
      </ContextMenu>
    );
    rightClick(view);

    expect(rows(view).map((row) => row.dataset.slot)).toEqual([
      'edit.cut',
      'edit.copy',
      'edit.paste',
      'edit.delete',
      'edit.selectAll',
      'text.link',
      'review.comments',
    ]);
    expect(rowNamed(view, 'edit.cut').textContent).toContain('igloo.carve');
  });

  // `Children.toArray` does not flatten Fragment ELEMENTS, so a host mapping over its
  // overrides reaches the scanner as a symbol-typed element. Unrecognised children APPEND,
  // so missing this rendered a SECOND Cut row instead of overriding the packaged one.
  test('a Fragment-wrapped override still replaces its row in place', () => {
    const { view } = mount(
      <ContextMenu t={t}>
        <>
          <ContextMenu.Cut hidden />
        </>
      </ContextMenu>
    );
    rightClick(view);

    expect(rows(view).map((row) => row.dataset.slot)).not.toContain('edit.cut');
    expect(rows(view).filter((row) => row.dataset.slot === 'edit.cut')).toHaveLength(0);
  });

  test('hidden removes a row', () => {
    const { view } = mount(
      <ContextMenu t={t}>
        <ContextMenu.Paste hidden />
      </ContextMenu>
    );
    rightClick(view);

    expect(rows(view).map((row) => row.dataset.slot)).not.toContain('edit.paste');
  });

  test('a host row appends after the default set', () => {
    const { view } = mount(
      <ContextMenu t={t}>
        <ContextMenu.Item label="Freeze paragraph" onSelect={() => {}} />
      </ContextMenu>
    );
    rightClick(view);

    expect(rows(view).at(-1)?.textContent).toContain('Freeze paragraph');
  });

  test('preset={false} renders children verbatim', () => {
    const { view } = mount(
      <ContextMenu t={t} preset={false}>
        <ContextMenu.Copy />
        <ContextMenu.Item label="Only mine" onSelect={() => {}} />
      </ContextMenu>
    );
    rightClick(view);

    expect(rows(view)).toHaveLength(2);
    expect(rows(view)[0]?.dataset.slot).toBe('edit.copy');
  });

  test('a host row runs its handler and closes the panel', () => {
    let ran = 0;
    const { view } = mount(
      <ContextMenu t={t} preset={false}>
        <ContextMenu.Item label="Freeze" onSelect={() => (ran += 1)} />
      </ContextMenu>
    );
    rightClick(view);

    act(() => {
      fireEvent.click(rows(view)[0]!);
    });

    expect(ran).toBe(1);
    expect(panel(view)).toBeNull();
  });

  test('a chrome slot renders as a row through Slot', () => {
    const { view } = mount(
      <ContextMenu t={t} preset={false}>
        <ContextMenu.Slot slot="text.bold" />
      </ContextMenu>
    );
    rightClick(view);

    expect(rows(view)[0]?.dataset.slot).toBe('text.bold');
  });
});

describe('closing', () => {
  test('Escape closes', () => {
    const { view } = mount();
    rightClick(view);
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(panel(view)).toBeNull();
  });

  test('a press outside closes', () => {
    const { view } = mount();
    rightClick(view);
    act(() => {
      fireEvent.pointerDown(document.body);
    });

    expect(panel(view)).toBeNull();
  });

  test('a press INSIDE the panel does not close it', () => {
    const { view } = mount();
    rightClick(view);
    act(() => {
      fireEvent.pointerDown(rowNamed(view, 'edit.copy'));
    });

    expect(panel(view)).not.toBeNull();
  });

  // Tab moves focus out of the panel, and neither the outside-press listener nor window
  // blur fires for an intra-page focus move — so the panel used to stay open with nothing
  // focused inside it.
  test('Tab closes', () => {
    const { view } = mount();
    rightClick(view);
    act(() => {
      fireEvent.keyDown(document, { key: 'Tab' });
    });

    expect(panel(view)).toBeNull();
  });

  test('scrolling closes', () => {
    const { view } = mount();
    rightClick(view);
    act(() => {
      fireEvent.scroll(document);
    });

    expect(panel(view)).toBeNull();
  });
});

describe('keyboard', () => {
  test('ArrowDown steps into the rows and wraps', () => {
    const { view } = mount();
    rightClick(view);
    const open = panel(view)!;

    act(() => {
      fireEvent.keyDown(open, { key: 'ArrowDown' });
    });
    expect(document.activeElement).toBe(rows(view)[0]!);

    act(() => {
      fireEvent.keyDown(open, { key: 'ArrowUp' });
    });
    expect(document.activeElement).toBe(rows(view).at(-1)!);
  });

  test('Home and End reach the ends', () => {
    const { view } = mount();
    rightClick(view);
    const open = panel(view)!;

    act(() => {
      fireEvent.keyDown(open, { key: 'End' });
    });
    expect(document.activeElement).toBe(rows(view).at(-1)!);

    act(() => {
      fireEvent.keyDown(open, { key: 'Home' });
    });
    expect(document.activeElement).toBe(rows(view)[0]!);
  });

  test('rows are reached by the arrows, never by Tab', () => {
    const { view } = mount();
    rightClick(view);

    for (const row of rows(view)) expect(row.tabIndex).toBe(-1);
  });
});

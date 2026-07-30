// The compound toolbar (default set + in-place overrides + font-family compound).
//
// Against the REAL engine, like editor-composition.test.tsx: a mounted document,
// painted pages, committed ops. What these pin down: the default arrangement and its
// order; that a part child REPLACES its slot in place (and `hidden` removes it);
// `preset={false}` verbatim rendering; live Bold state through a click; asChild prop
// merging; that FontFamily's options come from the DOCUMENT'S fonts and selecting one
// applies it; and the caret-preserving mousedown contract.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core-contract/editor';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';

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

/** Two families named by run-level rFonts, for the font-picker options assertion. */
const FONTED_SOURCE = docx(
  '<w:p>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/></w:rPr><w:t>serif</w:t></w:r>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr><w:t> mono</w:t></w:r>' +
    '</w:p>'
);

/** The default arrangement's aria-labels (raw i18n keys — no `t` in these tests). */
const DEFAULT_LABELS = [
  'formattingBar.undoShortcut',
  'formattingBar.redoShortcut',
  'formattingBar.boldShortcut',
  'formattingBar.italicShortcut',
  'formattingBar.underlineShortcut',
  'formattingBar.strikethrough',
  'alignment.alignLeft',
  'alignment.center',
  'alignment.alignRight',
  'alignment.justify',
  'font.selectAriaLabel',
];

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

function toolbarElement(view: ReturnType<typeof render>): HTMLElement {
  return view.getByTestId('docx-toolbar');
}

/** Toolbar children flattened to comparable identities, for order assertions. */
function childIdentities(toolbar: HTMLElement): string[] {
  return [...toolbar.children].map((child) => {
    if (child.getAttribute('role') === 'separator') return 'separator';
    return child.getAttribute('aria-label') ?? child.className;
  });
}

afterEach(() => {
  cleanup();
});

describe('the default arrangement', () => {
  test('renders the full default set in order, separators included', () => {
    const { view } = mountToolbar(<DocxEditorToolbar />);
    const toolbar = toolbarElement(view);
    expect(childIdentities(toolbar)).toEqual([
      'formattingBar.undoShortcut',
      'formattingBar.redoShortcut',
      'separator',
      'formattingBar.boldShortcut',
      'formattingBar.italicShortcut',
      'formattingBar.underlineShortcut',
      'formattingBar.strikethrough',
      'separator',
      'alignment.alignLeft',
      'alignment.center',
      'alignment.alignRight',
      'alignment.justify',
      'separator',
      'docx-toolbar__font-family',
    ]);
    // Every part is present exactly once, as a real control.
    for (const label of DEFAULT_LABELS.slice(0, -1)) {
      expect(view.container.querySelectorAll(`[aria-label="${label}"]`).length).toBe(1);
    }
  });

  test('a part child overrides its slot IN PLACE; non-part children append', () => {
    const { view } = mountToolbar(
      <DocxEditorToolbar>
        <DocxEditorToolbar.Bold className="custom-bold" />
        <span data-testid="extra">extra</span>
      </DocxEditorToolbar>
    );
    const toolbar = toolbarElement(view);
    // Same arrangement (plus the appended extra), with Bold still fourth.
    const identities = childIdentities(toolbar);
    expect(identities.slice(0, 14)).toEqual([
      'formattingBar.undoShortcut',
      'formattingBar.redoShortcut',
      'separator',
      'formattingBar.boldShortcut',
      'formattingBar.italicShortcut',
      'formattingBar.underlineShortcut',
      'formattingBar.strikethrough',
      'separator',
      'alignment.alignLeft',
      'alignment.center',
      'alignment.alignRight',
      'alignment.justify',
      'separator',
      'docx-toolbar__font-family',
    ]);
    expect(toolbar.children.length).toBe(15);
    // The Bold in the arrangement IS the override (its className landed).
    const bold = view.container.querySelector('[aria-label="formattingBar.boldShortcut"]')!;
    expect(bold.className).toContain('custom-bold');
    expect(toolbar.children[3]).toBe(bold);
    // The non-part child appended after the default set.
    expect(toolbar.lastElementChild).toBe(view.getByTestId('extra'));
  });

  test('a hidden part child removes its slot from the arrangement', () => {
    const { view } = mountToolbar(
      <DocxEditorToolbar>
        <DocxEditorToolbar.Strike hidden />
      </DocxEditorToolbar>
    );
    const toolbar = toolbarElement(view);
    expect(view.container.querySelector('[aria-label="formattingBar.strikethrough"]')).toBeNull();
    expect(toolbar.children.length).toBe(13);
    // Neighbours unaffected: underline still present, alignment group intact.
    expect(
      view.container.querySelector('[aria-label="formattingBar.underlineShortcut"]')
    ).not.toBeNull();
  });

  test('preset={false} renders only the children, verbatim, in order', () => {
    const { view } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.Bold />
        <DocxEditorToolbar.Separator />
        <DocxEditorToolbar.Undo />
      </DocxEditorToolbar>
    );
    const toolbar = toolbarElement(view);
    expect(childIdentities(toolbar)).toEqual([
      'formattingBar.boldShortcut',
      'separator',
      'formattingBar.undoShortcut',
    ]);
  });
});

describe('live button state', () => {
  test('Bold click applies bold: data-active appears and the snapshot agrees', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const bold = view.container.querySelector(
      '[aria-label="formattingBar.boldShortcut"]'
    ) as HTMLButtonElement;
    expect(bold.disabled).toBe(false);
    expect(bold.hasAttribute('data-active')).toBe(false);
    expect(bold.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      bold.click();
    });
    expect(bold.hasAttribute('data-active')).toBe(true);
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    expect(editor().snapshot().formatting?.bold).toBe(true);
  });

  test('a generic Button on an unwired slot is disabled with the not-wired reason', () => {
    const { view } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.Button slot="image.insert" />
      </DocxEditorToolbar>
    );
    const button = view.container.querySelector(
      '[aria-label="toolbar.image"]'
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.hasAttribute('data-disabled')).toBe(true);
    expect(button.title).toBe('not wired to an editor command');
    // Not a toggle: no aria-pressed claim.
    expect(button.hasAttribute('aria-pressed')).toBe(false);
  });

  test('asChild merges onto the child: className concat, click toggles, data-active flows', async () => {
    const { view, editor } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.Bold asChild className="mine">
          <button type="button" className="theirs" data-testid="as-child-bold">
            B
          </button>
        </DocxEditorToolbar.Bold>
      </DocxEditorToolbar>
    );
    await act(async () => {
      editor().surface!.selectAll();
    });
    const child = view.getByTestId('as-child-bold');
    // One rendered element: the child, carrying both class lists.
    expect(child.className).toContain('docx-toolbar__button');
    expect(child.className).toContain('mine');
    expect(child.className).toContain('theirs');
    expect(child.textContent).toBe('B');
    await act(async () => {
      child.click();
    });
    expect(child.hasAttribute('data-active')).toBe(true);
    expect(editor().snapshot().formatting?.bold).toBe(true);
  });
});

describe('the FontFamily compound', () => {
  test('options come from the DOCUMENT fonts; selecting applies and closes', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />, FONTED_SOURCE);
    expect(editor().getDocumentFonts()).toEqual(['Courier New', 'Georgia']);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const trigger = view.container.querySelector(
      '.docx-toolbar__font-family-trigger'
    ) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    // Mixed-font selection: no agreed value, so the trigger shows the em-dash.
    expect(trigger.textContent).toBe('—');

    await act(async () => {
      trigger.click();
    });
    const listbox = view.container.querySelector('[role="listbox"]')!;
    const options = [...listbox.querySelectorAll('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual(['Courier New', 'Georgia']);

    await act(async () => {
      (options[1] as HTMLButtonElement).click();
    });
    // Applied through can-before-exec, popup closed, trigger shows the new value.
    expect(editor().snapshot().formatting?.fontFamily).toBe('Georgia');
    expect(view.container.querySelector('[role="listbox"]')).toBeNull();
    expect(trigger.textContent).toBe('Georgia');
    // Reopened, the OPTIONS FOLLOWED THE EDIT: applying Georgia to the whole selection
    // rewrote both runs' rFonts, so Courier New left the document's font catalog — the
    // list re-derives from the document, not from a mount-time snapshot. And the one
    // remaining option is marked selected.
    await act(async () => {
      trigger.click();
    });
    const reopened = [...view.container.querySelectorAll('[role="option"]')];
    expect(reopened.map((option) => option.textContent)).toEqual(['Georgia']);
    expect(reopened[0]!.hasAttribute('data-selected')).toBe(true);
  });

  test('custom Item children render inside a composed FontFamily', async () => {
    const { view } = mountToolbar(
      <DocxEditorToolbar preset={false}>
        <DocxEditorToolbar.FontFamily>
          <DocxEditorToolbar.FontFamily.Trigger />
          <DocxEditorToolbar.FontFamily.Content>
            <DocxEditorToolbar.FontFamily.Item value="Georgia">
              <em data-testid="fancy-georgia">Fancy Georgia</em>
            </DocxEditorToolbar.FontFamily.Item>
          </DocxEditorToolbar.FontFamily.Content>
        </DocxEditorToolbar.FontFamily>
      </DocxEditorToolbar>,
      FONTED_SOURCE
    );
    const trigger = view.container.querySelector(
      '.docx-toolbar__font-family-trigger'
    ) as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });
    expect(view.getByTestId('fancy-georgia').textContent).toBe('Fancy Georgia');
  });
});

describe('the caret-preserving mousedown contract', () => {
  test('toolbar button mousedown is prevented; form-field mousedown is not', () => {
    const { view } = mountToolbar(
      <DocxEditorToolbar>
        <select data-testid="toolbar-select">
          <option value="x">x</option>
        </select>
      </DocxEditorToolbar>
    );
    const bold = view.container.querySelector('[aria-label="formattingBar.boldShortcut"]')!;
    const buttonEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    bold.dispatchEvent(buttonEvent);
    expect(buttonEvent.defaultPrevented).toBe(true);

    const select = view.getByTestId('toolbar-select');
    const selectEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    select.dispatchEvent(selectEvent);
    expect(selectEvent.defaultPrevented).toBe(false);
  });
});

describe('namespace statics', () => {
  test('DocxEditor.Toolbar IS the compound toolbar with its parts attached', () => {
    expect(DocxEditor.Toolbar).toBe(DocxEditorToolbar);
    expect(DocxEditorToolbar.Bold.docxSlot).toBe('text.bold');
    expect(DocxEditorToolbar.FontFamily.docxSlot).toBe('font.family');
    expect(typeof DocxEditorToolbar.Button).toBe('function');
    expect(typeof DocxEditorToolbar.Separator).toBe('function');
    expect(typeof DocxEditorToolbar.FontFamily.Trigger).toBe('function');
    expect(typeof DocxEditorToolbar.FontFamily.Content).toBe('function');
    expect(typeof DocxEditorToolbar.FontFamily.Item).toBe('function');
  });
});

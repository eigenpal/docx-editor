// The compound toolbar (full-registry default + in-place overrides + the shaped parts).
//
// Against the REAL engine, like editor-composition.test.tsx: a mounted document,
// painted pages, committed ops. What these pin down: the default arrangement IS the
// registry's default bar in registry order (derived from `defaultChromeGroups` here
// too, alignment merged, so a registry change updates the expectation); that a part
// child REPLACES its slot in
// place (and `hidden` removes it); `preset={false}` verbatim rendering; live Bold
// state through a click; asChild prop merging; the wired font-size stepper, zoom
// stepper, and colour split buttons; the undriven pickers rendering disabled; that
// FontFamily's options come from the DOCUMENT'S fonts and selecting one applies it;
// and the caret-preserving mousedown contract.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import {
  chromeSlotId,
  defaultChromeGroups,
  type DocxEditorInstance,
} from '@docx-editor.dev/core-contract/editor';
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

/**
 * The expected default arrangement, DERIVED from the registry exactly as the toolbar
 * derives it: every NON-CONTEXTUAL group in registry order (the default bar,
 * which ends at the editing-mode picker), a separator between groups, and the
 * alignment group MERGED into the one dropdown keyed `'alignment'`.
 * Identities are the parts' `data-slot` markers.
 */
const EXPECTED_ARRANGEMENT: readonly string[] = defaultChromeGroups().flatMap((group, index) => [
  ...(index > 0 ? ['separator'] : []),
  ...(group.id === 'alignment'
    ? ['alignment']
    : group.controls.map((control) => chromeSlotId(group, control) as string)),
]);

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
    return child.getAttribute('data-slot') ?? child.getAttribute('aria-label') ?? child.className;
  });
}

afterEach(() => {
  cleanup();
});

describe('the default arrangement', () => {
  test('renders the WHOLE chrome registry in registry order, separators between groups', () => {
    const { view } = mountToolbar(<DocxEditorToolbar />);
    const toolbar = toolbarElement(view);
    // The arrangement is derived from the registry on both sides of this assertion —
    // the 10 non-contextual groups, alignment merged — so a registry change updates
    // both in lockstep.
    expect(childIdentities(toolbar)).toEqual([...EXPECTED_ARRANGEMENT]);
    // Every slot is present exactly once.
    for (const slot of EXPECTED_ARRANGEMENT) {
      if (slot === 'separator') continue;
      expect(view.container.querySelectorAll(`[data-slot="${slot}"]`).length).toBe(1);
    }
    // Wired controls are live buttons; the labels come from the registry keys.
    expect(
      view.container.querySelector('[aria-label="formattingBar.boldShortcut"]')
    ).not.toBeNull();
    expect(
      view.container.querySelector('[aria-label="formattingBar.undoShortcut"]')
    ).not.toBeNull();
  });

  test('a part child overrides its slot IN PLACE; non-part children append', () => {
    const { view } = mountToolbar(
      <DocxEditorToolbar>
        <DocxEditorToolbar.Bold className="custom-bold" />
        <span data-testid="extra">extra</span>
      </DocxEditorToolbar>
    );
    const toolbar = toolbarElement(view);
    // Same full arrangement (plus the appended extra), with Bold still in its place.
    const identities = childIdentities(toolbar);
    expect(identities.slice(0, EXPECTED_ARRANGEMENT.length)).toEqual([...EXPECTED_ARRANGEMENT]);
    expect(toolbar.children.length).toBe(EXPECTED_ARRANGEMENT.length + 1);
    // The Bold in the arrangement IS the override (its className landed).
    const bold = view.container.querySelector('[aria-label="formattingBar.boldShortcut"]')!;
    expect(bold.className).toContain('custom-bold');
    expect(toolbar.children[EXPECTED_ARRANGEMENT.indexOf('text.bold')]).toBe(bold);
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
    expect(toolbar.children.length).toBe(EXPECTED_ARRANGEMENT.length - 1);
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
    expect(childIdentities(toolbar)).toEqual(['text.bold', 'separator', 'history.undo']);
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

/** A run with an explicit 12pt size (`w:sz` is half-points), for the stepper tests. */
const SIZED_SOURCE = docx(
  '<w:p><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>sized text</w:t></w:r></w:p>'
);

describe('the shaped parts', () => {
  test('the font-size stepper shows the selection size and a step applies through the engine', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />, SIZED_SOURCE);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const stepper = view.container.querySelector('[data-slot="font.size"]')!;
    const value = stepper.querySelector('.docx-toolbar__stepper-value')!;
    expect(value.textContent).toBe('12');
    const increase = stepper.querySelector('[aria-label="fontSize.increase"]') as HTMLButtonElement;
    expect(increase.disabled).toBe(false);
    await act(async () => {
      increase.click();
    });
    // The stepper walks the PRESET ladder (8..12, 14, 16, ...), not a fixed
    // increment: 12pt steps to 14pt, read back from the engine's snapshot.
    expect(editor().snapshot().formatting?.fontSizePt).toBe(14);
    expect(value.textContent).toBe('14');
    const decrease = stepper.querySelector('[aria-label="fontSize.decrease"]') as HTMLButtonElement;
    await act(async () => {
      decrease.click();
    });
    expect(editor().snapshot().formatting?.fontSizePt).toBe(12);
  });

  test('the zoom stepper drives Editor.setZoom and reads the snapshot back', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    const stepper = view.container.querySelector('[data-slot="zoom.level"]')!;
    const value = stepper.querySelector('.docx-toolbar__stepper-value')!;
    // The middle is the "% ▾" menu button: the level plus the caret glyph.
    expect(value.textContent).toBe('100%▾');
    const zoomIn = stepper.querySelector('[aria-label="zoom.zoomIn"]') as HTMLButtonElement;
    await act(async () => {
      zoomIn.click();
    });
    // The buttons walk the preset LEVELS (50/75/100/125/150/200), not a fixed
    // step: 100% steps to 125%.
    expect(editor().snapshot().zoom).toBe(1.25);
    expect(value.textContent).toBe('125%▾');
    const zoomOut = stepper.querySelector('[aria-label="zoom.zoomOut"]') as HTMLButtonElement;
    await act(async () => {
      zoomOut.click();
    });
    expect(editor().snapshot().zoom).toBe(1);
  });

  test('the font-colour split applies its seed from the main half and a swatch pick from the grid', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const split = view.container.querySelector('[data-slot="text.color"]')!;
    const main = split.querySelector('.docx-toolbar__colorsplit-main') as HTMLButtonElement;
    expect(main.disabled).toBe(false);
    await act(async () => {
      main.click();
    });
    // The seed is the registry swatch: the chrome spec's default red (the apply
    // half starts at { rgb: 'FF0000' } before any pick).
    expect(editor().snapshot().formatting?.color).toEqual({ kind: 'hex', value: 'FF0000' });

    const caret = split.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement;
    await act(async () => {
      caret.click();
    });
    const swatch = split.querySelector('[data-value="000000"]') as HTMLButtonElement;
    expect(swatch).not.toBeNull();
    await act(async () => {
      swatch.click();
    });
    expect(editor().snapshot().formatting?.color).toEqual({ kind: 'hex', value: '000000' });
    // A pick closes the popup.
    expect(split.querySelector('.docx-toolbar__swatch-popup')).toBeNull();
  });

  test('the highlight split applies yellow by default and an ST_HighlightColor name from the grid', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const split = view.container.querySelector('[data-slot="text.highlight"]')!;
    const main = split.querySelector('.docx-toolbar__colorsplit-main') as HTMLButtonElement;
    await act(async () => {
      main.click();
    });
    expect(editor().snapshot().formatting?.highlight).toBe('yellow');

    const caret = split.querySelector('.docx-toolbar__colorsplit-caret') as HTMLButtonElement;
    await act(async () => {
      caret.click();
    });
    const swatch = split.querySelector('[data-value="cyan"]') as HTMLButtonElement;
    await act(async () => {
      swatch.click();
    });
    expect(editor().snapshot().formatting?.highlight).toBe('cyan');
  });

  test('an undriven dropdown renders as a DISABLED combobox-lookalike, never a control', () => {
    const { view } = mountToolbar(<DocxEditorToolbar />);
    for (const slot of ['styles.style', 'review.editingMode']) {
      const picker = view.container.querySelector(`[data-slot="${slot}"]`)!;
      expect(picker.tagName).toBe('SPAN');
      expect(picker.getAttribute('aria-disabled')).toBe('true');
      expect(picker.className).toContain('docx-toolbar__picker');
      // No interactive element inside: nothing to click, nothing faked.
      expect(picker.querySelector('button')).toBeNull();
    }
    // The registry placeholder value shows (raw keys — no `t` here).
    expect(
      view.container.querySelector('[data-slot="styles.style"] .docx-toolbar__picker-value')!
        .textContent
    ).toBe('styles.normalText');
  });

  test('save is NOT in the default bar (contextual slot); composed, it needs onSave to be live', async () => {
    // The registry's default bar ends at the editing-mode picker: save belongs in
    // the host's File menu, so its slot is contextual and absent from the default
    // arrangement.
    const onSaveCalls: number[] = [];
    const { view } = mountToolbar(<DocxEditorToolbar onSave={() => onSaveCalls.push(1)} />);
    expect(view.container.querySelector('[data-slot="file.save"]')).toBeNull();
    cleanup();

    // Explicitly composed (appended after the default set), it is live with a handler…
    const { view: composed } = mountToolbar(
      <DocxEditorToolbar onSave={() => onSaveCalls.push(1)}>
        <DocxEditorToolbar.Save />
      </DocxEditorToolbar>
    );
    const save = composed.container.querySelector('[data-slot="file.save"]') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => {
      save.click();
    });
    expect(onSaveCalls.length).toBe(1);
    cleanup();

    // …and disabled without one: Editor.save() returns bytes the HOST must deliver.
    const { view: bare } = mountToolbar(
      <DocxEditorToolbar>
        <DocxEditorToolbar.Save />
      </DocxEditorToolbar>
    );
    const disabledSave = bare.container.querySelector(
      '[data-slot="file.save"]'
    ) as HTMLButtonElement;
    expect(disabledSave.disabled).toBe(true);
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
    // The default menu is the GROUPED picker: classified families under small gray
    // headings in the chrome spec's group order (serif before monospace), not one flat
    // alphabetical list.
    const options = [...listbox.querySelectorAll('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual(['Georgia', 'Courier New']);
    expect(
      [...listbox.querySelectorAll('.docx-toolbar__menu-label')].map((label) => label.textContent)
    ).toEqual(['font.serif', 'font.monospace']);

    await act(async () => {
      (options[0] as HTMLButtonElement).click();
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
    // The selected row carries the right-edge ✓ (part of its text content).
    expect(reopened.map((option) => option.textContent)).toEqual(['Georgia✓']);
    expect(reopened[0]!.hasAttribute('data-selected')).toBe(true);
    expect(reopened[0]!.querySelector('.docx-toolbar__menu-check')).not.toBeNull();
  });

  test('custom Item children render inside a composed FontFamily', async () => {
    const { view, editor } = mountToolbar(
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
    // The font picker writes RUN formatting, so it needs a range — a collapsed caret
    // carries none yet and the trigger is honestly disabled until something is selected.
    await act(async () => {
      editor().surface!.selectAll();
    });
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
    // The shaped parts carry their slot statics too.
    expect(DocxEditorToolbar.FontSize.docxSlot).toBe('font.size');
    expect(DocxEditorToolbar.FontColor.docxSlot).toBe('text.color');
    expect(DocxEditorToolbar.Highlight.docxSlot).toBe('text.highlight');
    expect(DocxEditorToolbar.Zoom.docxSlot).toBe('zoom.level');
    expect(DocxEditorToolbar.StylePicker.docxSlot).toBe('styles.style');
    expect(DocxEditorToolbar.EditingMode.docxSlot).toBe('review.editingMode');
    expect(DocxEditorToolbar.Save.docxSlot).toBe('file.save');
    expect(DocxEditorToolbar.BulletList.docxSlot).toBe('list.bullet');
    expect(DocxEditorToolbar.TableInsert.docxSlot).toBe('table.insert');
  });
});

// The React half of the enabled-state contract the Vue toolbar is held to in
// `packages/vue/test/toolbar-engine-state.test.ts`. Same slots, same rules: a control is
// enabled because `Editor.can` said so, never because the chrome registry said so.
//
// React always worked here — `ToolbarButton` goes through `useEditorCommand` and has
// never read the registry's state kind — while Vue branched on it and rendered twelve
// wired commands permanently disabled. These assertions are the tripwire that keeps
// React on the engine's answer, so the two adapters cannot drift apart again.
describe('enabled state is the engine answer, not a registry constant', () => {
  test('underline is live: enabled at a range selection, and a click applies it', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const underline = view.container.querySelector(
      '[data-slot="text.underline"]'
    ) as HTMLButtonElement;
    expect(underline.disabled).toBe(false);
    // The label, not an "unavailable" apology.
    expect(underline.title).toBe('formattingBar.underlineShortcut');
    await act(async () => {
      underline.click();
    });
    expect(editor().snapshot().formatting?.underline).toBe(true);
    expect(underline.hasAttribute('data-active')).toBe(true);
  });

  test('the list controls are live, and outdent tracks the engine rather than a flag', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const indent = view.container.querySelector('[data-slot="list.indent"]') as HTMLButtonElement;
    const outdent = view.container.querySelector('[data-slot="list.outdent"]') as HTMLButtonElement;
    expect(indent.disabled).toBe(false);
    // Nothing to outdent at level 0 — the engine's answer, and it changes when the
    // document does.
    expect(outdent.disabled).toBe(true);
    await act(async () => {
      indent.click();
    });
    expect(outdent.disabled).toBe(false);
  });

  test('a slot with no command is dead with the engine reason, inside the default bar', () => {
    const { view } = mountToolbar(<DocxEditorToolbar />);
    for (const slot of ['text.link', 'script.super', 'script.sub', 'format.clear']) {
      const button = view.container.querySelector(`[data-slot="${slot}"]`) as HTMLButtonElement;
      expect(button.disabled, slot).toBe(true);
      expect(button.title, slot).toBe('not wired to an editor command');
    }
  });

  test('a wired control the engine refuses NOW shows the engine reason', () => {
    // Run formatting needs a range: at a collapsed caret the engine refuses, and the
    // tooltip is its refusal — not a permanent "unavailable in preview".
    const { view } = mountToolbar(<DocxEditorToolbar />);
    const underline = view.container.querySelector(
      '[data-slot="text.underline"]'
    ) as HTMLButtonElement;
    expect(underline.disabled).toBe(true);
    expect(underline.title).not.toBe('formattingBar.underlineShortcut');
    expect(underline.title.length).toBeGreaterThan(0);
  });
});

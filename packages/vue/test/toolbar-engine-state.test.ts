// The Vue toolbar's enabled state IS the engine's answer.
//
// The regression this pins: the toolbar branched on the chrome registry's
// `state.kind === 'parityOnly'` BEFORE consulting `toolbarCommandState`, so twelve
// controls the engine executes — underline, strike, the four alignments, the four list
// controls, and the four value slots — rendered permanently disabled with "unavailable
// in preview" while the React toolbar ran them. A registry constant cannot be a second,
// staler answer to what `Editor.can` decides.
//
// Against the REAL engine, like the React toolbar test: a mounted document, a real
// selection, committed ops read back from the snapshot. A stub would prove the adapter
// calls a helper; only the engine proves the user gets the command.

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, nextTick } from 'vue';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core-contract/editor';
import DocxEditorToolbar from '../src/DocxEditorToolbar';

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

const teardowns: (() => void)[] = [];

function mountToolbar(): { editor: DocxEditorInstance; toolbar: HTMLElement } {
  const surfaceHost = document.createElement('div');
  document.body.appendChild(surfaceHost);
  const editor = createDocxEditor({ container: surfaceHost, document: SOURCE });

  const toolbarHost = document.createElement('div');
  document.body.appendChild(toolbarHost);
  // Raw i18n keys, not English: the adapter only holds keys, so a label assertion below
  // reads the key and can never accidentally pin a translation.
  const app = createApp(DocxEditorToolbar, { editor, t: (key: string) => key });
  app.mount(toolbarHost);

  teardowns.push(() => {
    app.unmount();
    editor.destroy();
    toolbarHost.remove();
    surfaceHost.remove();
  });
  return { editor, toolbar: toolbarHost };
}

/** One slot's rendered control. Test ids are keyed on the SLOT id, never the control id. */
function slot(toolbar: HTMLElement, id: string): HTMLElement {
  const element = toolbar.querySelector(`[data-testid="toolbar-${id}"]`);
  expect(element, `slot ${id} is missing from the toolbar`).not.toBeNull();
  return element as HTMLElement;
}

afterEach(() => {
  for (const teardown of teardowns.splice(0)) teardown();
});

describe('the Vue toolbar reads enabled state from the engine', () => {
  test('underline is LIVE: enabled at a range selection, and a click reaches the engine', async () => {
    const { editor, toolbar } = mountToolbar();
    editor.surface!.selectAll();
    await nextTick();

    const underline = slot(toolbar, 'text.underline') as HTMLButtonElement;
    expect(underline.tagName).toBe('BUTTON');
    expect(underline.disabled).toBe(false);
    // The label, not an "unavailable" apology.
    expect(underline.title).toBe('formattingBar.underlineShortcut');
    expect(underline.getAttribute('aria-pressed')).toBe('false');

    underline.click();
    await nextTick();
    expect(editor.snapshot().formatting?.underline).toBe(true);
    expect(underline.getAttribute('aria-pressed')).toBe('true');
  });

  test('the list controls are live: a bullet click commits a change', async () => {
    const { editor, toolbar } = mountToolbar();
    editor.surface!.selectAll();
    await nextTick();

    const changes: number[] = [];
    const off = editor.on('change', () => changes.push(1));
    const bullet = slot(toolbar, 'list.bullet') as HTMLButtonElement;
    expect(bullet.disabled).toBe(false);
    bullet.click();
    await nextTick();
    off();
    // The engine committed: `toggleList` is not derivable through `isActive`, so the
    // proof that the click landed is the document changing.
    expect(changes.length).toBeGreaterThan(0);
  });

  test('strike, numbering and indent are live, and outdent tracks the engine', async () => {
    const { editor, toolbar } = mountToolbar();
    editor.surface!.selectAll();
    await nextTick();
    for (const id of ['text.strike', 'list.numbered', 'list.indent']) {
      expect((slot(toolbar, id) as HTMLButtonElement).disabled, id).toBe(false);
    }
    // Outdent is the sharpest proof that the state is LIVE rather than a constant: at
    // indent level 0 the engine refuses it, and it enables itself once there is an
    // indent to remove.
    const outdent = slot(toolbar, 'list.outdent') as HTMLButtonElement;
    expect(outdent.disabled).toBe(true);
    expect(outdent.title).not.toContain('formattingBar.unavailableInPreview');
    (slot(toolbar, 'list.indent') as HTMLButtonElement).click();
    await nextTick();
    expect(outdent.disabled).toBe(false);
  });

  test('the merged alignment dropdown applies an alignment', async () => {
    const { editor, toolbar } = mountToolbar();
    editor.surface!.selectAll();
    await nextTick();

    const trigger = toolbar.querySelector(
      '.ep-toolbar__alignment-trigger'
    ) as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    expect(trigger!.disabled).toBe(false);
    trigger!.click();
    await nextTick();
    (slot(toolbar, 'alignment.center') as HTMLButtonElement).click();
    await nextTick();
    expect(editor.snapshot().formatting?.alignment).toBe('center');
  });

  test('a slot with no command stays dead, with the ENGINE’s reason as the tooltip', async () => {
    const { toolbar } = mountToolbar();
    await nextTick();
    // Not wired in the shared command table: the control is visible, disabled, and says
    // WHY in the engine's own words — never an adapter paraphrase, never a claim that
    // the capability is missing when only the wiring is.
    for (const id of ['text.link', 'script.super', 'script.sub', 'format.clear']) {
      const button = slot(toolbar, id) as HTMLButtonElement;
      expect(button.disabled, id).toBe(true);
      expect(button.title, id).toBe('not wired to an editor command');
    }
  });

  test('a wired control the engine refuses NOW is disabled with the engine’s reason', async () => {
    // Run formatting needs a range: at a collapsed caret the engine refuses, and the
    // control must show THAT, not the registry's old permanent "unavailable in preview".
    const { toolbar } = mountToolbar();
    await nextTick();
    const underline = slot(toolbar, 'text.underline') as HTMLButtonElement;
    expect(underline.disabled).toBe(true);
    expect(underline.title).not.toContain('formattingBar.unavailableInPreview');
    expect(underline.title.length).toBeGreaterThan(0);
  });

  test('the shapes this toolbar cannot drive still render, and say so', async () => {
    // Known gap, stated honestly: the value slots need a picker to produce their value
    // and this toolbar has none yet (React's do). They are disabled by the ADAPTER, and
    // their tooltip says so — the engine would honour a value here.
    const { toolbar } = mountToolbar();
    await nextTick();
    for (const id of ['font.family', 'font.size', 'styles.style', 'zoom.level']) {
      const picker = slot(toolbar, id);
      expect(picker.tagName, id).toBe('SPAN');
      expect(picker.getAttribute('aria-disabled'), id).toBe('true');
      expect(picker.querySelector('button'), id).toBeNull();
    }
    for (const id of ['text.color', 'text.highlight']) {
      const split = slot(toolbar, id) as HTMLButtonElement;
      expect(split.disabled, id).toBe(true);
      expect(split.title, id).toContain('formattingBar.unavailableInPreview');
    }
  });
});

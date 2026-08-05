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
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
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

function mountToolbar(source: Uint8Array = SOURCE): {
  editor: DocxEditorInstance;
  toolbar: HTMLElement;
} {
  const surfaceHost = document.createElement('div');
  document.body.appendChild(surfaceHost);
  const editor = createDocxEditor({ container: surfaceHost, document: source });

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

  test('superscript, subscript and clear-formatting are live here too', async () => {
    // Parity with React's half of this contract: these three are plain command slots, so
    // wiring them in the shared table has to light them up in BOTH adapters at once.
    const { editor, toolbar } = mountToolbar();
    editor.surface!.selectAll();
    await nextTick();
    for (const id of ['script.super', 'script.sub', 'format.clear']) {
      const button = slot(toolbar, id) as HTMLButtonElement;
      expect(button.disabled, id).toBe(false);
      expect(button.title, id).not.toBe('not wired to an editor command');
    }

    const superscript = slot(toolbar, 'script.super') as HTMLButtonElement;
    superscript.click();
    await nextTick();
    expect(editor.snapshot().formatting?.superscript).toBe(true);
    expect(superscript.getAttribute('aria-pressed')).toBe('true');

    (slot(toolbar, 'format.clear') as HTMLButtonElement).click();
    await nextTick();
    expect(editor.snapshot().formatting?.superscript).toBe(false);
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

  test('nothing the default bar renders is dead any more', async () => {
    const { toolbar } = mountToolbar();
    await nextTick();
    // This carried a shrinking list of slots with no command behind them: `script.super`,
    // `script.sub` and `format.clear` graduated to real commands, and `review.comments` now
    // toggles the review pane. One is left, so the assertion pins the WHOLE set rather than
    // sampling it — a new dead control fails here, and so does a stale entry. The remaining
    // unwired slots (image, table, TOC) are contextual and not in this bar.
    // `[data-testid^="toolbar-"]`, because the Vue toolbar emits no `data-slot` at all — a
    // selector borrowed from React matched nothing and the assertion could never fail.
    const controls = [...toolbar.querySelectorAll('[data-testid^="toolbar-"]')];
    expect(controls.length).toBeGreaterThan(10);
    const dead = controls.filter(
      (part) => part.getAttribute('title') === 'not wired to an editor command'
    );
    // `text.link` is the one left, and for a reason particular to THIS adapter: the slot is
    // deliberately absent from the shared command table so an adapter with no link UI cannot
    // grow an enabled button it can only refuse, and Vue has no link popover to drive it. It
    // comes off this list when Vue gets one — not before.
    expect(dead.map((part) => part.getAttribute('data-testid'))).toEqual(['toolbar-text.link']);
  });

  test('a wired control the engine refuses NOW is disabled with the engine’s reason', async () => {
    // Undo over an empty history: the engine refuses, and the control must show THAT, not
    // the registry's old permanent "unavailable in preview". A refusal that lifts as soon
    // as the document moves is the whole point — a registry constant could not.
    const { editor, toolbar } = mountToolbar(
      docx('<w:p><w:r><w:t>alpha</w:t></w:r></w:p><w:p><w:r><w:t>beta</w:t></w:r></w:p>')
    );
    editor.surface!.selectAll();
    await nextTick();
    const undo = slot(toolbar, 'history.undo') as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(undo.title).not.toContain('formattingBar.unavailableInPreview');
    expect(undo.title).toContain('nothing to undo');

    (slot(toolbar, 'text.underline') as HTMLButtonElement).click();
    await nextTick();
    expect(undo.disabled).toBe(false);
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

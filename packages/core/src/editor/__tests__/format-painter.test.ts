// Word's Format Painter: copy the formatting here, paint it there, move no text.
//
// Three things are worth pinning and nothing else in the suite covers them:
//
//   1. The capture reads the RESOLVED cascade. Every other formatting write in the engine
//      bases itself on what a run AUTHORS, because echoing the cascade freezes inherited
//      formatting as direct. The painter is the one place where echoing it is the point:
//      copying from a styled heading whose runs author nothing must still carry the face
//      the reader can see, or the feature does nothing on exactly the documents that need
//      it most.
//   2. The LEVEL follows the selection, the way Word's does. A range inside a paragraph is
//      character formatting; a range that covers a paragraph mark carries the paragraph
//      style and its direct properties too.
//   3. Painting is SUBTRACTIVE as well as additive. A capture spells out the properties
//      that are OFF, so painting plain text over bold text un-bolds it.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { toolbarCommandState, runToolbarCommand } from '../toolbar-commands.ts';
import { createKeyDownHandler } from '../surface-input.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

// `Fancy` authors the whole face — bold, 24pt, red, Georgia — so a run inside a paragraph
// written in it authors NOTHING and the capture has to resolve the cascade to see any of it.
const STYLES =
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>' +
  '</w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Fancy"><w:name w:val="Fancy"/><w:rPr>' +
  '<w:b/><w:sz w:val="48"/><w:color w:val="FF0000"/>' +
  '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/></w:rPr></w:style>' +
  '</w:styles>';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${STYLE_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (runs: string, pPr = '') => `<w:p>${pPr}${runs}</w:p>`;
const textRun = (text: string, rPr = '') =>
  `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;

/** A `Fancy` paragraph, centred and indented, whose run states nothing of its own. */
const STYLED = p(
  textRun('styled'),
  '<w:pPr><w:pStyle w:val="Fancy"/><w:jc w:val="center"/><w:ind w:left="720"/></w:pPr>'
);
const PLAIN = p(textRun('plain'));
/** No runs at all: the layout publishes no style span for it, so nothing resolves a face. */
const EMPTY_STYLED = p('', '<w:pPr><w:pStyle w:val="Fancy"/><w:jc w:val="center"/></w:pPr>');

function withEditor(body: string, run: (editor: DocxEditorInstance) => void): void {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body) });
  if (!editor.surface) throw new Error('surface failed to mount');
  try {
    run(editor);
  } finally {
    editor.destroy();
    container.remove();
  }
}

function paragraphNodes(part: { root: OoxmlNode }): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'paragraph') found.push(node);
    if (node.kind === 'textValue') return;
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return found;
}

function describeProperties(container: OoxmlNode): string[] {
  if (container.kind === 'textValue') return [];
  return container.children.flatMap((child) => {
    if (child.kind === 'textValue') return [];
    const val = child.attributes.find((entry) => entry.localName === 'val')?.value;
    const ascii = child.attributes.find((entry) => entry.localName === 'ascii')?.value;
    if (val === undefined) return [ascii === undefined ? child.localName : `rFonts=${ascii}`];
    return [`${child.localName}=${val}`];
  });
}

/** The `w:rPr` children of one run, as `name=val` strings. */
function runProperties(editor: DocxEditorInstance, paragraph: number, run = 0): string[] {
  const node = paragraphNodes(editor.surface!.session.part())[paragraph]!;
  if (node.kind === 'textValue') return [];
  const target = node.children.filter((child) => child.kind === 'run')[run];
  if (!target || target.kind === 'textValue') return [];
  const rPr = target.children.find((child) => child.kind === 'runProperties');
  return rPr ? describeProperties(rPr) : [];
}

/** One paragraph's own `w:pPr`, minus the mark's run properties. */
function paragraphProperties(editor: DocxEditorInstance, paragraph: number): string[] {
  const node = paragraphNodes(editor.surface!.session.part())[paragraph]!;
  if (node.kind === 'textValue') return [];
  const pPr = node.children.find((child) => child.kind === 'paragraphProperties');
  if (!pPr || pPr.kind === 'textValue') return [];
  return describeProperties(pPr).filter((entry) => entry !== 'rPr');
}

function select(editor: DocxEditorInstance, from: [number, number], to: [number, number]): void {
  const ids = editor.surface!.session.paragraphIds();
  editor.surface!.setSelection({
    anchor: { paragraphId: ids[from[0]]!, offset: from[1] },
    head: { paragraphId: ids[to[0]]!, offset: to[1] },
  });
}

const caretAt = (editor: DocxEditorInstance, paragraph: number, offset: number): void =>
  select(editor, [paragraph, offset], [paragraph, offset]);

describe('the capture', () => {
  test('reads the resolved cascade, so a styled run carries what the reader sees', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      // The source run authors NOTHING: everything visible about it comes from `Fancy`.
      expect(runProperties(editor, 0)).toEqual([]);

      select(editor, [0, 0], [0, 6]);
      expect(editor.exec({ type: 'copyFormatting' })).toMatchObject({ ok: true });
      select(editor, [1, 0], [1, 5]);
      expect(editor.exec({ type: 'pasteFormatting' })).toMatchObject({ ok: true });

      const painted = runProperties(editor, 1);
      expect(painted).toContain('b=1');
      expect(painted).toContain('sz=48');
      expect(painted).toContain('color=FF0000');
      expect(painted).toContain('rFonts=Georgia');
    });
  });

  test('a range inside one paragraph copies character formatting alone', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      // Two characters short of the paragraph's end, so no paragraph mark is covered.
      select(editor, [0, 0], [0, 4]);
      expect(editor.exec({ type: 'copyFormatting' })).toMatchObject({ ok: true });
      expect(editor.surface!.formatPainter.state().level).toBe('run');

      select(editor, [1, 0], [1, 5]);
      editor.exec({ type: 'pasteFormatting' });
      // The target keeps its own (absent) paragraph formatting: no style, no alignment.
      expect(paragraphProperties(editor, 1)).toEqual([]);
      expect(runProperties(editor, 1)).toContain('b=1');
    });
  });

  test('a selection that covers the paragraph mark copies paragraph formatting too', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      expect(editor.exec({ type: 'copyFormatting' })).toMatchObject({ ok: true });
      expect(editor.surface!.formatPainter.state().level).toBe('paragraph');

      select(editor, [1, 0], [1, 5]);
      editor.exec({ type: 'pasteFormatting' });
      expect(paragraphProperties(editor, 1)).toEqual(['pStyle=Fancy', 'ind', 'jc=center']);
    });
  });

  test('an EMPTY paragraph still copies its paragraph formatting', () => {
    withEditor(EMPTY_STYLED + PLAIN, (editor) => {
      caretAt(editor, 0, 0);
      expect(editor.exec({ type: 'copyFormatting' })).toMatchObject({ ok: true });
      expect(editor.surface!.formatPainter.state().level).toBe('paragraph');

      select(editor, [1, 0], [1, 5]);
      expect(editor.exec({ type: 'pasteFormatting' })).toMatchObject({ ok: true, changed: true });
      expect(paragraphProperties(editor, 1)).toEqual(['pStyle=Fancy', 'jc=center']);
      // No text to read a face from, so the capture states no character formatting and the
      // target's runs keep their own rather than taking an invented one.
      expect(runProperties(editor, 1)).toEqual([]);
    });
  });

  test('a collapsed caret copies paragraph formatting, as Word does', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      caretAt(editor, 0, 3);
      expect(editor.exec({ type: 'copyFormatting' })).toMatchObject({ ok: true });
      expect(editor.surface!.formatPainter.state().level).toBe('paragraph');
    });
  });
});

describe('painting', () => {
  test('is subtractive: plain formatting over bold text clears the bold', () => {
    withEditor(p(textRun('plain')) + p(textRun('loud', '<w:rPr><w:b/></w:rPr>')), (editor) => {
      select(editor, [0, 0], [0, 5]);
      editor.exec({ type: 'copyFormatting' });
      select(editor, [1, 0], [1, 4]);
      editor.exec({ type: 'pasteFormatting' });
      // Explicitly off, not merely dropped: `w:b` may be inherited, so the override has to
      // state the off value or the style's bold comes straight back.
      expect(runProperties(editor, 1)).toContain('b=0');
      expect(editor.snapshot().formatting?.bold).toBe(false);
    });
  });

  test('carries the run properties a toolbar never shows, so the target cannot keep its own', () => {
    const loud =
      '<w:rPr><w:spacing w:val="40"/><w:position w:val="6"/>' +
      '<w:w w:val="150"/><w:kern w:val="32"/></w:rPr>';
    withEditor(p(textRun('plain')) + p(textRun('wide', loud)), (editor) => {
      select(editor, [0, 0], [0, 5]);
      editor.exec({ type: 'copyFormatting' });
      select(editor, [1, 0], [1, 4]);
      editor.exec({ type: 'pasteFormatting' });
      // `runPropertyEdits` MERGES over what the target authors, so anything the capture does
      // not name survives the paint. Expanded, raised, stretched text would have.
      const painted = runProperties(editor, 1);
      expect(painted).toContain('spacing=0');
      expect(painted).toContain('position=0');
      expect(painted).toContain('w=100');
      expect(painted).toContain('kern=0');
    });
  });

  test('the paragraph write replaces rather than merges, so the source is what survives', () => {
    withEditor(PLAIN + STYLED, (editor) => {
      select(editor, [0, 0], [0, 5]);
      editor.exec({ type: 'copyFormatting' });
      select(editor, [1, 0], [1, 6]);
      editor.exec({ type: 'pasteFormatting' });
      // The plain source states no style, no alignment and no indent, so the styled target
      // keeps none of its own — it ends up formatted like the source, which is the promise.
      expect(paragraphProperties(editor, 1)).toEqual([]);
    });
  });

  test('the painted result survives a save and reopen', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: docx(STYLED + PLAIN) });
    try {
      select(editor, [0, 0], [0, 6]);
      editor.exec({ type: 'copyFormatting' });
      select(editor, [1, 0], [1, 5]);
      editor.exec({ type: 'pasteFormatting' });
      const bytes = new Uint8Array(await editor.save());

      const reopened = document.createElement('div');
      document.body.append(reopened);
      const second = createDocxEditor({ container: reopened, document: bytes });
      try {
        expect(paragraphProperties(second, 1)).toEqual(['pStyle=Fancy', 'ind', 'jc=center']);
        expect(runProperties(second, 1)).toContain('sz=48');
        expect(runProperties(second, 1)).toContain('color=FF0000');
      } finally {
        second.destroy();
        reopened.remove();
      }
    } finally {
      editor.destroy();
      container.remove();
    }
  });
});

describe('the control', () => {
  test('painting is refused with the engine’s reason until something is copied', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [1, 0], [1, 5]);
      const gate = editor.can({ type: 'pasteFormatting' });
      expect(gate.ok).toBe(false);
      if (!gate.ok) expect(gate.reason).toBe('no formatting has been copied');
      expect(editor.exec({ type: 'pasteFormatting' })).toMatchObject({ ok: false });
    });
  });

  test('a press arms the painter for one application and reports the mode', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      expect(toolbarCommandState(editor, 'format.painter')).toMatchObject({
        enabled: true,
        active: false,
        value: 'off',
      });

      expect(runToolbarCommand(editor, 'format.painter')).toMatchObject({ ok: true });
      expect(toolbarCommandState(editor, 'format.painter')).toMatchObject({
        enabled: true,
        active: true,
        value: 'once',
      });
    });
  });

  test('a second press inside the double-press window locks it on', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      runToolbarCommand(editor, 'format.painter');
      runToolbarCommand(editor, 'format.painter');
      expect(editor.surface!.formatPainter.state().mode).toBe('locked');
    });
  });

  test('a press on a LOCKED painter stands it down, as a second click does in Word', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      runToolbarCommand(editor, 'format.painter');
      runToolbarCommand(editor, 'format.painter');
      expect(editor.surface!.formatPainter.state().mode).toBe('locked');
      runToolbarCommand(editor, 'format.painter');
      expect(editor.surface!.formatPainter.state().mode).toBe('off');
    });
  });

  test('standing down clears the double-press window, so the next press arms once', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      runToolbarCommand(editor, 'format.painter');
      // Cancel it, then press again straight away. Without clearing the window the third
      // press read as the second half of a double-click and locked the painter on.
      editor.surface!.formatPainter.disarm();
      runToolbarCommand(editor, 'format.painter');
      expect(editor.surface!.formatPainter.state().mode).toBe('once');
    });
  });

  test('the control greys out on a document open for viewing', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
      const state = toolbarCommandState(editor, 'format.painter');
      // Arming a painter this document will refuse to apply is the dead button the
      // enabled-state rule exists to prevent.
      expect(state.enabled).toBe(false);
      expect(state.disabledReason).toBe('the document is open for viewing');
    });
  });

  test('a lone second press outside the window stands it down again', async () => {
    withEditor(STYLED + PLAIN, (editor) => {
      select(editor, [0, 0], [0, 6]);
      runToolbarCommand(editor, 'format.painter');
      // Past the engine's 500ms double-press window, so this reads as a separate press.
      Bun.sleepSync(520);
      runToolbarCommand(editor, 'format.painter');
      expect(editor.surface!.formatPainter.state().mode).toBe('off');
      // The CAPTURE survives standing down — only the arming ends, so Paste Formatting and
      // the keyboard chord still work.
      expect(editor.surface!.formatPainter.state().level).toBe('paragraph');
    });
  });
});

describe('the keyboard', () => {
  const chord = (key: string, code: string, init: KeyboardEventInit = {}): KeyboardEvent =>
    new KeyboardEvent('keydown', { key, code, cancelable: true, ...init });

  test('Cmd+Alt+C copies and Cmd+Alt+V paints — Command on a Mac, Ctrl elsewhere', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      const onKeyDown = createKeyDownHandler(editor.surface!);

      select(editor, [0, 0], [0, 6]);
      // `metaKey`: the keymap treats Cmd and Ctrl as ONE accelerator, so the Mac chord and
      // the Windows chord reach the same command.
      onKeyDown(chord('ç', 'KeyC', { metaKey: true, altKey: true }));
      expect(editor.surface!.formatPainter.state().level).toBe('paragraph');

      select(editor, [1, 0], [1, 5]);
      onKeyDown(chord('√', 'KeyV', { metaKey: true, altKey: true }));
      expect(runProperties(editor, 1)).toContain('sz=48');
    });
  });

  test('Ctrl+Alt+C works the same way, and reads the key rather than the code', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      const onKeyDown = createKeyDownHandler(editor.surface!);
      select(editor, [0, 0], [0, 6]);
      onKeyDown(chord('c', '', { ctrlKey: true, altKey: true }));
      expect(editor.surface!.formatPainter.state().level).toBe('paragraph');
    });
  });

  test('Escape stands the armed painter down before it releases any other mode', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      const onKeyDown = createKeyDownHandler(editor.surface!);
      select(editor, [0, 0], [0, 6]);
      runToolbarCommand(editor, 'format.painter');
      expect(editor.surface!.formatPainter.state().mode).toBe('once');

      const event = chord('Escape', 'Escape');
      onKeyDown(event);
      expect(event.defaultPrevented).toBe(true);
      expect(editor.surface!.formatPainter.state().mode).toBe('off');
    });
  });

  test('Ctrl+Shift+V still arms a force-plain paste — the painter did not take it', () => {
    withEditor(STYLED + PLAIN, (editor) => {
      const onKeyDown = createKeyDownHandler(editor.surface!);
      select(editor, [0, 0], [0, 6]);
      const event = chord('V', 'KeyV', { ctrlKey: true, shiftKey: true });
      onKeyDown(event);
      // Not prevented: the browser's own paste has to follow, and the armed flag is what the
      // paste handler reads. Nothing was captured, so the painter stayed out of it.
      expect(event.defaultPrevented).toBe(false);
      expect(editor.surface!.formatPainter.state().level).toBe('none');
    });
  });
});

describe('the drag gesture', () => {
  const MARGIN = 72;

  function mount(body: string): { surface: PaginatedSurface; pages: HTMLElement } {
    const container = document.createElement('div');
    document.body.append(container);
    const result = mountPaginatedSurface(container, docx(body), { scale: 1 });
    if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    // happy-dom reports no layout, so the one measurement the pointer controller makes is
    // supplied. A non-zero origin, so a controller that forgot to subtract it would fail.
    Object.defineProperty(pages, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 100,
        top: 50,
        right: 1100,
        bottom: 1050,
        width: 1000,
        height: 1000,
        x: 100,
        y: 50,
      }),
    });
    return { surface: result.surface, pages };
  }

  const pointer = (type: string, x: number, y: number): PointerEvent =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 100 + MARGIN + x,
      clientY: 50 + MARGIN + y,
    });

  /** Drag across the second paragraph's line, which is where the painter should land. */
  function dragSecondLine(pages: HTMLElement): void {
    pages.dispatchEvent(pointer('pointerdown', -40, 25));
    document.dispatchEvent(pointer('pointermove', 500, 25));
    document.dispatchEvent(pointer('pointerup', 500, 25));
  }

  test('an armed painter paints the range the drag produced, then stands down', () => {
    const { surface, pages } = mount(STYLED + PLAIN);
    try {
      const ids = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[0]!, offset: 6 },
      });
      surface.formatPainter.press();
      expect(surface.formatPainter.state().mode).toBe('once');
      // The affordance the reader sees: the pages layer says the next drag paints.
      expect(pages.dataset['formatPainter']).toBe('');

      dragSecondLine(pages);

      expect(surface.formatPainter.state().mode).toBe('off');
      expect(pages.dataset['formatPainter']).toBeUndefined();
      const painted = paragraphNodes(surface.session.part())[1]!;
      expect(painted.kind === 'paragraph' && describeProperties(painted).length).toBeGreaterThan(0);
    } finally {
      surface.destroy();
    }
  });

  test('a cancelled gesture does not paint and leaves the painter armed', () => {
    const { surface, pages } = mount(STYLED + PLAIN);
    try {
      const ids = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[0]!, offset: 6 },
      });
      surface.formatPainter.press();
      const before = surface.session.packageRevision();

      // `pointercancel` is the browser TAKING the gesture away — a system touch gesture, a
      // device change — so the range under the pointer is not one the user chose.
      pages.dispatchEvent(pointer('pointerdown', -40, 25));
      document.dispatchEvent(pointer('pointermove', 500, 25));
      document.dispatchEvent(pointer('pointercancel', 500, 25));

      expect(surface.session.packageRevision()).toBe(before);
      expect(surface.formatPainter.state().mode).toBe('once');
    } finally {
      surface.destroy();
    }
  });

  test('apply reports the document’s refusal rather than its own op count', () => {
    const { surface } = mount(STYLED + PLAIN);
    try {
      const ids = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[0]!, offset: 6 },
      });
      expect(surface.formatPainter.capture()).toBe(true);
      // The write is built and then refused, which is exactly the case an op count cannot
      // see: `commit` hands nothing back, so the model revision is what settles it.
      surface.setEditingMode('view');
      surface.setSelection({
        anchor: { paragraphId: ids[1]!, offset: 0 },
        head: { paragraphId: ids[1]!, offset: 5 },
      });
      expect(surface.formatPainter.apply()).toBe(false);
    } finally {
      surface.destroy();
    }
  });

  test('a locked painter stays armed after painting', () => {
    const { surface, pages } = mount(STYLED + PLAIN);
    try {
      const ids = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[0]!, offset: 6 },
      });
      surface.formatPainter.press();
      surface.formatPainter.press();
      expect(surface.formatPainter.state().mode).toBe('locked');

      dragSecondLine(pages);

      expect(surface.formatPainter.state().mode).toBe('locked');
      expect(pages.dataset['formatPainter']).toBe('');
    } finally {
      surface.destroy();
    }
  });
});

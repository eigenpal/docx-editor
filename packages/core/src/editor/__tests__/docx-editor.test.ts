// The tree-lane Editor facade over the paginated surface (phase 3, part 1).
//
// What these tests pin down: the facade drives the REAL surface (painted pages, committed
// ops, round-trippable bytes), refuses what it does not support with typed results rather
// than silence, and honours mode: 'view' as a facade-level gate.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string, extraParts: Record<string, string> = {}): Uint8Array {
  const overrides = Object.keys(extraParts)
    .map((name) => `<Override PartName="/${name}" ContentType="application/xml"/>`)
    .join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${overrides}</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    ...Object.fromEntries(
      Object.entries(extraParts).map(([name, xml]) => [name, strToU8(xml)] as const)
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function mount(
  body: string,
  options: { mode?: 'edit' | 'view'; zoom?: number } = {}
): { editor: DocxEditorInstance; container: HTMLElement } {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: docx(body),
    ...options,
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container };
}

describe('createDocxEditor', () => {
  test('mounting paints pages into the container', () => {
    const { editor, container } = mount(p('hello world'));
    expect(container.querySelector('.docx-pages')).not.toBeNull();
    const spans = container.querySelectorAll('[data-paragraph-id][data-start]');
    expect(spans.length).toBeGreaterThan(0);
    expect(container.textContent).toContain('hello world');
    expect(editor.getTotalPages()).toBe(1);
  });

  test('toggleMark bold applies over a selection and formatting reflects it', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    const result = editor.exec({ type: 'toggleMark', mark: 'bold' });
    expect(result).toEqual({ ok: true, changed: true });
    expect(editor.getSelectionFormatting()?.bold).toBe(true);
    expect(editor.query({ type: 'selectionFormatting' })?.bold).toBe(true);
  });

  test('a collapsed caret reports the formatting of the run beside it', () => {
    const { editor } = mount(
      '<w:p><w:r><w:t>plain</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>'
    );
    const pid = '/word/document.xml#0.0.0';
    const caret = (offset: number) => ({
      anchor: { paragraphId: pid, offset },
      head: { paragraphId: pid, offset },
    });
    editor.exec({ type: 'setSelection', range: caret(7) });
    expect(editor.getSelectionFormatting()?.bold).toBe(true);
    expect(editor.isActive({ type: 'toggleMark', mark: 'bold' })).toBe(true);
    editor.exec({ type: 'setSelection', range: caret(2) });
    expect(editor.getSelectionFormatting()?.bold).toBe(false);
    expect(editor.isActive({ type: 'toggleMark', mark: 'bold' })).toBe(false);
  });

  test('every toggleMark toggles OFF again, not just bold', () => {
    // A mark missing from `isRunPropertyActive` reads as never-active, so its toggle
    // re-applies forever instead of clearing — every toggleable mark must round-trip.
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    for (const [mark, read] of [
      ['bold', 'bold'],
      ['italic', 'italic'],
      ['underline', 'underline'],
      ['strike', 'strike'],
    ] as const) {
      editor.exec({ type: 'toggleMark', mark });
      expect(editor.snapshot().formatting?.[read]).toBe(true);
      editor.exec({ type: 'toggleMark', mark });
      expect(editor.snapshot().formatting?.[read]).toBe(false);
    }
  });

  test('setAlignment writes w:jc and formatting reports it', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    expect(editor.exec({ type: 'setAlignment', align: 'center' })).toEqual({
      ok: true,
      changed: true,
    });
    expect(editor.getSelectionFormatting()?.alignment).toBe('center');
    // `justify` is spelled `both` in OOXML and read back as such.
    editor.exec({ type: 'setAlignment', align: 'justify' });
    expect(editor.getSelectionFormatting()?.alignment).toBe('both');
  });

  test('insertText types at the selection; undo and redo walk the history', () => {
    const { editor } = mount(p('ab'));
    expect(editor.exec({ type: 'insertText', text: 'X' })).toEqual({ ok: true, changed: true });
    expect(editor.surface!.session.bodyText()).toBe('Xab');
    expect(editor.exec({ type: 'undo' })).toEqual({ ok: true, changed: true });
    expect(editor.surface!.session.bodyText()).toBe('ab');
    expect(editor.exec({ type: 'redo' })).toEqual({ ok: true, changed: true });
    expect(editor.surface!.session.bodyText()).toBe('Xab');
    // An empty history REFUSES rather than silently no-opping: `can` drives the
    // toolbar, and Word greys out undo/redo when there is nothing left.
    editor.exec({ type: 'undo' });
    expect(editor.can({ type: 'undo' }).ok).toBe(false);
    const spent = editor.exec({ type: 'undo' });
    expect(spent.ok).toBe(false);
    if (!spent.ok) expect(spent.reason).toBe('nothing to undo');
  });

  test('undo/redo enablement follows the history', () => {
    const { editor } = mount(p('ab'));
    expect(editor.can({ type: 'undo' }).ok).toBe(false);
    expect(editor.can({ type: 'redo' }).ok).toBe(false);
    editor.exec({ type: 'insertText', text: 'X' });
    expect(editor.can({ type: 'undo' }).ok).toBe(true);
    expect(editor.can({ type: 'redo' }).ok).toBe(false);
    editor.exec({ type: 'undo' });
    expect(editor.can({ type: 'undo' }).ok).toBe(false);
    expect(editor.can({ type: 'redo' }).ok).toBe(true);
  });

  test('save() round-trips: the bytes reopen and the edit survives', async () => {
    const { editor } = mount(p('hello'));
    editor.exec({ type: 'insertText', text: 'X' });
    const buffer = await editor.save();
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    const bytes = new Uint8Array(buffer);
    const reopened = readOoxmlPackage(bytes);
    expect(reopened.ok).toBe(true);
    // And the second editor sees the edit, which is the round trip that matters.
    const second = mount(p('placeholder'));
    second.editor.load(bytes);
    expect(second.editor.surface!.session.bodyText()).toBe('Xhello');
  });

  test('snapshot reports the honest read model', () => {
    const { editor } = mount(p('hello'));
    const snapshot = editor.snapshot();
    expect(snapshot.scope).toEqual({ kind: 'body' });
    expect(snapshot.isLoading).toBe(false);
    expect(snapshot.parseError).toBeNull();
    expect(snapshot.editable).toBe(true);
    expect(snapshot.zoom).toBe(1);
    expect(snapshot.selection).toBeNull();
    expect(snapshot.table).toBeNull();
    expect(snapshot.image).toBeNull();
    expect(snapshot.page).toEqual({ current: 1, total: 1 });
    expect(editor.getCurrentPage()).toBe(1);
  });

  test("mode: 'view' refuses every mutating command with a typed result", () => {
    const { editor } = mount(p('hello'), { mode: 'view' });
    editor.surface!.selectAll();
    const result = editor.exec({ type: 'toggleMark', mark: 'bold' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('locked');
    expect(editor.can({ type: 'insertText', text: 'X' })).toMatchObject({
      ok: false,
      code: 'locked',
    });
    expect(editor.snapshot().editable).toBe(false);
    // The document is untouched.
    expect(editor.surface!.session.bodyText()).toBe('hello');
  });

  test('an unsupported command is refused, never silently dropped', () => {
    const { editor } = mount(p('hello'));
    const result = editor.exec({ type: 'insertTable', rows: 2, cols: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsupported');
    expect(editor.can({ type: 'insertTable', rows: 2, cols: 2 })).toMatchObject({
      ok: false,
      code: 'unsupported',
    });
    // A page break rides insertBreak but is not wired; a line break is.
    expect(editor.can({ type: 'insertBreak', kind: 'page' })).toMatchObject({
      ok: false,
      code: 'unsupported',
    });
    expect(editor.can({ type: 'insertBreak', kind: 'line' })).toEqual({ ok: true });
  });

  test('setSelection passes a semantic paragraph selection through to the surface', () => {
    const { editor } = mount(p('hello'));
    const id = editor.surface!.session.paragraphIds()[0]!;
    const result = editor.exec({
      type: 'setSelection',
      range: {
        anchor: { paragraphId: id, offset: 1 },
        head: { paragraphId: id, offset: 4 },
      } as never,
    });
    expect(result).toEqual({ ok: true, changed: false });
    expect(editor.query({ type: 'selectedText' })).toBe('ell');
    expect(editor.surface!.selectedText()).toBe('ell');
  });

  test('load() with new bytes replaces the document', () => {
    const { editor, container } = mount(p('first'));
    editor.load(docx(p('second')));
    expect(container.textContent).toContain('second');
    expect(container.textContent).not.toContain('first');
    expect(editor.surface!.session.bodyText()).toBe('second');
  });

  test('load() with a DocumentHandle emits a typed error and keeps the document', () => {
    const { editor } = mount(p('hello'));
    const errors: { code?: string }[] = [];
    editor.on('error', (error) => errors.push(error));
    editor.load(editor.getDocumentHandle());
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('unsupported');
    expect(editor.surface!.session.bodyText()).toBe('hello');
  });

  test('unparsable bytes surface as an error event and snapshot parseError', () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({ container });
    const errors: Error[] = [];
    editor.on('error', (error) => errors.push(error));
    editor.load(strToU8('not a zip'));
    expect(errors).toHaveLength(1);
    expect(editor.snapshot().parseError).not.toBeNull();
    expect(editor.surface).toBeNull();
    expect(editor.exec({ type: 'undo' })).toMatchObject({ ok: false, code: 'notFound' });
  });

  test("on('change') fires per committed exec with the new revision", () => {
    const { editor } = mount(p('hello'));
    const changes: number[] = [];
    const off = editor.on('change', (change) => changes.push(change.revision));
    editor.exec({ type: 'insertText', text: 'X' });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toBe(editor.getDocumentHandle().revision);
    off();
    editor.exec({ type: 'insertText', text: 'Y' });
    expect(changes).toHaveLength(1);
  });

  test("on('selectionChange') fires when the selection moves", () => {
    const { editor } = mount(p('hello'));
    let fired = 0;
    editor.on('selectionChange', () => {
      fired += 1;
    });
    const id = editor.surface!.session.paragraphIds()[0]!;
    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 2 },
      head: { paragraphId: id, offset: 2 },
    });
    expect(fired).toBeGreaterThan(0);
  });

  test('getPageSetup reads the section the document declares (defaults here)', () => {
    const { editor } = mount(p('hello'));
    expect(editor.getPageSetup()).toEqual({
      pageWidthTwips: 12240,
      pageHeightTwips: 15840,
      orientation: 'portrait',
      marginsTwips: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    });
  });

  test('setPageSetup writes margins, repaginates, and undoes as one step', () => {
    const { editor } = mount(p('hello'));
    expect(editor.can({ type: 'setPageSetup', marginLeft: 720 })).toEqual({ ok: true });
    const result = editor.exec({ type: 'setPageSetup', marginLeft: 720, marginTop: 900 });
    expect(result).toEqual({ ok: true, changed: true });
    expect(editor.getPageSetup()?.marginsTwips).toEqual({
      top: 900,
      right: 1440,
      bottom: 1440,
      left: 720,
    });
    expect(editor.snapshot().canUndo).toBe(true);
    editor.exec({ type: 'undo' });
    expect(editor.getPageSetup()?.marginsTwips.left).toBe(1440);
  });

  test('setPageSetup orientation swaps the stored dimensions', () => {
    const { editor } = mount(p('hello'));
    editor.exec({ type: 'setPageSetup', orientation: 'landscape' });
    expect(editor.getPageSetup()).toMatchObject({
      pageWidthTwips: 15840,
      pageHeightTwips: 12240,
      orientation: 'landscape',
    });
    // Back to portrait: the dimensions swap back, whichever way they were stored.
    editor.exec({ type: 'setPageSetup', orientation: 'portrait' });
    expect(editor.getPageSetup()).toMatchObject({
      pageWidthTwips: 12240,
      pageHeightTwips: 15840,
      orientation: 'portrait',
    });
  });

  test('setPageSetup refuses hostile values with typed reasons', () => {
    const { editor } = mount(p('hello'));
    expect(editor.can({ type: 'setPageSetup' })).toMatchObject({ ok: false });
    expect(editor.can({ type: 'setPageSetup', pageWidth: 0 })).toMatchObject({
      ok: false,
      code: 'invalidArgs',
    });
    expect(editor.can({ type: 'setPageSetup', marginLeft: -1 })).toMatchObject({
      ok: false,
      code: 'invalidArgs',
    });
    // Margins that swallow the page are refused by the op layer: nothing commits.
    const before = editor.getDocumentHandle().revision;
    editor.exec({ type: 'setPageSetup', marginLeft: 8000, marginRight: 8000 });
    expect(editor.getDocumentHandle().revision).toBe(before);
  });

  test('snapshot().pageSetup is reference-stable until the section changes', () => {
    const { editor } = mount(p('hello'));
    const first = editor.snapshot().pageSetup;
    expect(first).toEqual(editor.getPageSetup());
    // An edit that does not touch the section keeps the same sub-object reference.
    editor.exec({ type: 'insertText', text: 'X' });
    expect(editor.snapshot().pageSetup).toBe(first);
    // A section write moves it.
    editor.exec({ type: 'setPageSetup', marginLeft: 720 });
    expect(editor.snapshot().pageSetup).not.toBe(first);
    expect(editor.snapshot().pageSetup?.marginsTwips.left).toBe(720);
  });

  test('zoom is validated, stored, and reported', () => {
    const { editor } = mount(p('hello'));
    expect(editor.getZoom()).toBe(1);
    expect(editor.setZoom(0)).toMatchObject({ ok: false, code: 'invalidArgs' });
    expect(editor.setZoom(Number.NaN)).toMatchObject({ ok: false, code: 'invalidArgs' });
    expect(editor.setZoom(1.5)).toEqual({ ok: true, changed: true });
    expect(editor.getZoom()).toBe(1.5);
    expect(editor.setZoom(1.5)).toEqual({ ok: true, changed: false });
  });

  test('the honest-empty members answer with typed empty values', () => {
    const { editor } = mount(p('hello'));
    expect(editor.isActive({ type: 'toggleMark', mark: 'bold' })).toBe(false);
    expect(editor.getDocumentStyles()).toEqual([]);
    expect(editor.getOutline()).toEqual([]);
    expect(editor.getComments()).toEqual([]);
    expect(editor.findMatches('hello')).toEqual([]);
    expect(editor.getSelectedTable()).toBeNull();
    expect(editor.getWatermark()).toBeNull();
    expect(editor.getDisplay()).toEqual([]);
    expect(editor.getCaretRect()).toBeNull();
    expect(editor.hitTest({ x: 0, y: 0 })).toBeNull();
    expect(editor.query({ type: 'paragraphs' })).toEqual([]);
    expect(editor.query({ type: 'selection' })).toBeNull();
    const dispatch = editor.dispatchInteraction({
      kind: 'focus',
      frameId: { value: 0 },
    });
    expect(dispatch.outcome.ok).toBe(false);
    expect(dispatch.hostEffects).toEqual([]);
    const frame = editor.getInteractionFrame();
    expect(frame.display).toEqual([]);
    expect(frame.selection).toBeNull();
  });

  // ── State tick + cached snapshot identity ──────────────────────────────────────────

  test('snapshot() is cached: same reference until state moves, new after an edit', () => {
    const { editor } = mount(p('hello'));
    const first = editor.snapshot();
    expect(editor.snapshot()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.page)).toBe(true);

    editor.exec({ type: 'insertText', text: 'X' });
    const second = editor.snapshot();
    expect(second).not.toBe(first);
    // Sub-object reuse: the page did not change, so its reference survives re-derivation.
    expect(second.page).toBe(first.page);
    expect(editor.snapshot()).toBe(second);
  });

  test('formatting sub-object changes reference only when its value changes', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    const before = editor.snapshot();
    editor.exec({ type: 'toggleMark', mark: 'bold' });
    const after = editor.snapshot();
    expect(after).not.toBe(before);
    expect(after.formatting?.bold).toBe(true);
    expect(after.formatting).not.toBe(before.formatting);
    expect(after.page).toBe(before.page);
  });

  test('stateVersion bumps on commits, zoom, and load', () => {
    const { editor } = mount(p('hello'));
    const start = editor.stateVersion();
    editor.exec({ type: 'insertText', text: 'X' });
    const afterEdit = editor.stateVersion();
    expect(afterEdit).toBeGreaterThan(start);
    editor.setZoom(2);
    const afterZoom = editor.stateVersion();
    expect(afterZoom).toBeGreaterThan(afterEdit);
    editor.load(docx(p('reloaded')));
    expect(editor.stateVersion()).toBeGreaterThan(afterZoom);
  });

  test('load() success emits change (with the revision) and selectionChange', () => {
    const container = document.createElement('div');
    const editor = createDocxEditor({ container });
    const revisions: number[] = [];
    const snapshots: unknown[] = [];
    editor.on('change', (change) => revisions.push(change.revision));
    editor.on('selectionChange', (snapshot) => snapshots.push(snapshot));
    editor.load(docx(p('arrived')));
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toBe(editor.getDocumentHandle().revision);
    expect(snapshots.length).toBeGreaterThan(0);
  });

  test('setZoom emits selectionChange with the fresh cached snapshot', () => {
    const { editor } = mount(p('hello'));
    let received: ReturnType<typeof editor.snapshot> | null = null;
    editor.on('selectionChange', (snapshot) => {
      received = snapshot;
    });
    expect(editor.setZoom(1.5)).toEqual({ ok: true, changed: true });
    expect(received).not.toBeNull();
    expect(received!.zoom).toBe(1.5);
    // The emitted snapshot IS the cached one — no second derivation for readers.
    expect(editor.snapshot()).toBe(received!);
  });

  test('snapshot carries canUndo/canRedo derived from the session history', () => {
    const { editor } = mount(p('hello'));
    expect(editor.snapshot().canUndo).toBe(false);
    expect(editor.snapshot().canRedo).toBe(false);
    editor.exec({ type: 'insertText', text: 'X' });
    expect(editor.snapshot().canUndo).toBe(true);
    expect(editor.snapshot().canRedo).toBe(false);
    editor.exec({ type: 'undo' });
    expect(editor.snapshot().canRedo).toBe(true);
  });

  // ── isActive derivation (marks + alignment) ────────────────────────────────────────

  test('isActive lights for toggleMark after bolding the selection', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    expect(editor.isActive({ type: 'toggleMark', mark: 'bold' })).toBe(false);
    editor.exec({ type: 'toggleMark', mark: 'bold' });
    expect(editor.isActive({ type: 'toggleMark', mark: 'bold' })).toBe(true);
    expect(editor.isActive({ type: 'toggleMark', mark: 'italic' })).toBe(false);
    editor.exec({ type: 'toggleMark', mark: 'bold' });
    expect(editor.isActive({ type: 'toggleMark', mark: 'bold' })).toBe(false);
  });

  test('a change handler reading snapshot() mid-commit cannot poison the cache', () => {
    // The session notifies BEFORE the layout publishes, so a handler that reads
    // `snapshot()` inside `change` derives formatting from the pre-commit layout. The
    // publish must invalidate that cached derivation even though the selection did not
    // move, or the stale answer would be served for the rest of the version.
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    editor.on('change', () => {
      editor.snapshot(); // the poisoning read
    });
    editor.exec({ type: 'toggleMark', mark: 'bold' });
    expect(editor.snapshot().formatting?.bold).toBe(true);
    expect(editor.isActive({ type: 'toggleMark', mark: 'bold' })).toBe(true);
  });

  test('isActive maps justify to OOXML both for setAlignment', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    expect(editor.isActive({ type: 'setAlignment', align: 'left' })).toBe(true);
    editor.exec({ type: 'setAlignment', align: 'justify' });
    expect(editor.isActive({ type: 'setAlignment', align: 'justify' })).toBe(true);
    expect(editor.isActive({ type: 'setAlignment', align: 'center' })).toBe(false);
  });

  test('snapshot formatting carries the full derivable shape', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    editor.exec({ type: 'setAlignment', align: 'center' });
    const formatting = editor.snapshot().formatting;
    expect(formatting?.alignment).toBe('center');
    expect(formatting?.superscript).toBe(false);
    expect(formatting?.subscript).toBe(false);
    // getSelectionFormatting reads the SAME derivation.
    expect(editor.getSelectionFormatting()?.alignment).toBe('center');
  });

  // ── attach / detach ────────────────────────────────────────────────────────────────

  test('created without a container, attach() mounts the pending document', () => {
    const editor = createDocxEditor({ document: docx(p('hello')) });
    expect(editor.surface).toBeNull();
    const container = document.createElement('div');
    editor.attach(container);
    expect(editor.surface).not.toBeNull();
    expect(container.textContent).toContain('hello');
  });

  test('detach() stashes the CURRENT content; a later attach restores it', () => {
    const editor = createDocxEditor({ document: docx(p('hello')) });
    const first = document.createElement('div');
    editor.attach(first);
    editor.exec({ type: 'insertText', text: 'X' });
    expect(editor.surface!.session.bodyText()).toBe('Xhello');

    const beforeDetach = editor.stateVersion();
    editor.detach();
    expect(editor.surface).toBeNull();
    expect(first.childNodes.length).toBe(0);
    expect(editor.stateVersion()).toBeGreaterThan(beforeDetach);

    const second = document.createElement('div');
    editor.attach(second);
    // The edit survives; the undo stack does not (a mount from bytes is a new session).
    expect(second.textContent).toContain('Xhello');
    expect(editor.snapshot().canUndo).toBe(false);
  });

  test('attach after destroy is a refused no-op with a typed error', () => {
    const editor = createDocxEditor({ document: docx(p('hello')) });
    editor.destroy();
    const errors: { code?: string }[] = [];
    editor.on('error', (error) => errors.push(error));
    editor.attach(document.createElement('div'));
    expect(editor.surface).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('destroyed');
  });

  test('destroy() detaches the surface and empties the container', () => {
    const { editor, container } = mount(p('hello'));
    editor.destroy();
    expect(container.childNodes.length).toBe(0);
    expect(editor.surface).toBeNull();
    expect(editor.exec({ type: 'insertText', text: 'X' })).toMatchObject({
      ok: false,
      code: 'notFound',
    });
  });
});

describe('setMarkAttr (value-typed run formatting)', () => {
  test('fontFamily writes the rFonts spelling the engine reads back (ascii + hAnsi)', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    expect(
      editor.exec({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value: 'Georgia' })
    ).toEqual({ ok: true, changed: true });
    expect(editor.snapshot().formatting?.fontFamily).toBe('Georgia');
    expect(editor.getSelectionFormatting()?.fontFamily).toBe('Georgia');
  });

  test('fontSize takes half-points and formatting reports both vocabularies', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    expect(editor.exec({ type: 'setMarkAttr', mark: 'fontSize', attr: 'val', value: 28 })).toEqual({
      ok: true,
      changed: true,
    });
    expect(editor.snapshot().formatting?.fontSizePt).toBe(14);
    expect(editor.getSelectionFormatting()?.fontSizeHalfPoints).toBe(28);
  });

  test('color and highlight apply and read back from the selection', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    expect(
      editor.exec({ type: 'setMarkAttr', mark: 'color', attr: 'val', value: 'FF0000' })
    ).toEqual({ ok: true, changed: true });
    expect(editor.snapshot().formatting?.color).toEqual({ kind: 'hex', value: 'FF0000' });
    expect(
      editor.exec({ type: 'setMarkAttr', mark: 'highlight', attr: 'val', value: 'yellow' })
    ).toEqual({ ok: true, changed: true });
    expect(editor.snapshot().formatting?.highlight).toBe('yellow');
  });

  test("color 'auto' and highlight 'none' clear rather than being refused", () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    editor.exec({ type: 'setMarkAttr', mark: 'color', attr: 'val', value: 'FF0000' });
    editor.exec({ type: 'setMarkAttr', mark: 'highlight', attr: 'val', value: 'yellow' });
    expect(editor.exec({ type: 'setMarkAttr', mark: 'color', attr: 'val', value: 'auto' })).toEqual(
      { ok: true, changed: true }
    );
    expect(
      editor.exec({ type: 'setMarkAttr', mark: 'highlight', attr: 'val', value: 'none' })
    ).toEqual({ ok: true, changed: true });
    // The read lane reports both as "no value" — which is what Automatic/No Color mean.
    expect(editor.snapshot().formatting?.color).toBeUndefined();
    expect(editor.snapshot().formatting?.highlight ?? null).toBeNull();
  });

  test('a document without a theme part answers no theme colours', () => {
    const { editor } = mount(p('hello'));
    expect(editor.getDocumentThemeColors()).toEqual([]);
  });

  test('font boxes show the EFFECTIVE font: style chain, docDefaults, theme fonts', () => {
    const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const styles =
      `<w:styles xmlns:w="${W}">` +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:asciiTheme="minorHAnsi"/><w:sz w:val="22"/>' +
      '</w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:styleId="Title"><w:rPr>' +
      '<w:rFonts w:ascii="Georgia"/><w:sz w:val="52"/></w:rPr></w:style>' +
      '</w:styles>';
    const theme =
      `<a:theme xmlns:a="${A}"><a:themeElements><a:fontScheme name="Office">` +
      '<a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>' +
      '<a:minorFont><a:latin typeface="Calibri"/></a:minorFont>' +
      '</a:fontScheme></a:themeElements></a:theme>';
    const container = document.createElement('div');
    const editor = createDocxEditor({
      container,
      document: docx(
        '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Heading</w:t></w:r></w:p>' +
          p('body text'),
        { 'word/styles.xml': styles, 'word/theme/theme1.xml': theme }
      ),
    });
    const caret = (paragraphId: string, offset: number) => ({
      anchor: { paragraphId, offset },
      head: { paragraphId, offset },
    });
    // Caret in the styled heading: the style's own rPr wins.
    editor.exec({ type: 'setSelection', range: caret('/word/document.xml#0.0.0', 3) });
    expect(editor.snapshot().formatting?.fontFamily).toBe('Georgia');
    expect(editor.snapshot().formatting?.fontSizePt).toBe(26);
    // Caret in unstyled body text: docDefaults, with the theme font resolved.
    editor.exec({ type: 'setSelection', range: caret('/word/document.xml#0.0.1', 3) });
    expect(editor.snapshot().formatting?.fontFamily).toBe('Calibri');
    expect(editor.snapshot().formatting?.fontSizePt).toBe(11);
  });

  test('invalid values are refused as invalidArgs before touching the document', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    const before = editor.surface!.session.revision();
    const badColor = editor.exec({ type: 'setMarkAttr', mark: 'color', attr: 'val', value: 'red' });
    expect(badColor.ok).toBe(false);
    if (!badColor.ok) expect(badColor.code).toBe('invalidArgs');
    const badHighlight = editor.exec({
      type: 'setMarkAttr',
      mark: 'highlight',
      attr: 'val',
      value: 'chartreuse',
    });
    expect(badHighlight.ok).toBe(false);
    if (!badHighlight.ok) expect(badHighlight.code).toBe('invalidArgs');
    for (const value of [1, 3277, 11.5, '22']) {
      const bad = editor.exec({ type: 'setMarkAttr', mark: 'fontSize', attr: 'val', value });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.code).toBe('invalidArgs');
    }
    const badFamily = editor.exec({
      type: 'setMarkAttr',
      mark: 'fontFamily',
      attr: 'family',
      value: 'x'.repeat(500),
    });
    expect(badFamily.ok).toBe(false);
    if (!badFamily.ok) expect(badFamily.code).toBe('invalidArgs');
    expect(editor.surface!.session.revision()).toBe(before);
  });

  test('an unknown mark is refused as unsupported, and can() agrees with exec()', () => {
    const { editor } = mount(p('hello'));
    editor.surface!.selectAll();
    const refusal = editor.exec({ type: 'setMarkAttr', mark: 'kerning', attr: 'val', value: 1 });
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) expect(refusal.code).toBe('unsupported');
    const canAnswer = editor.can({ type: 'setMarkAttr', mark: 'kerning', attr: 'val', value: 1 });
    expect(canAnswer.ok).toBe(false);
    if (!canAnswer.ok) expect(canAnswer.code).toBe('unsupported');
    // And a valid command passes `can` without executing anything.
    expect(
      editor.can({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value: 'Arial' }).ok
    ).toBe(true);
  });
});

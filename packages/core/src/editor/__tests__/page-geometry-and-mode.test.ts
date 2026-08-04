// `getPageGeometry` and `setMode` — the two members that replaced a cluster of stubs.
//
// `getPageGeometry` was the ONLY member of the old geometry cluster with a real caller (both
// Vue rulers), and it returned `[]`, so those rulers rendered nothing for as long as they
// shipped. These tests exist so that cannot come back silently: a ruler asking for the page
// box must get a real one.
//
// `setMode` replaced "recreate the editor to change the mode". The point of the test is that
// the change is felt WITHOUT a remount — same instance, same undo history, different gate.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { rulerPageBox } from '../ruler-ticks.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function mount(body: string, options: { mode?: 'edit' | 'view' } = {}): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: docx(body), ...options });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

describe('getPageGeometry', () => {
  test('reports a real page box, not an empty list', () => {
    const editor = mount(p('hello'));
    const pages = editor.getPageGeometry();

    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]!.index).toBe(0);
    expect(pages[0]!.box.width).toBeGreaterThan(0);
    expect(pages[0]!.box.height).toBeGreaterThan(0);
  });

  // The regression this whole member exists for: `rulerPageBox` returns null on an empty
  // list, and both Vue rulers render nothing when it does.
  test('feeds rulerPageBox a box, so the rulers have something to draw', () => {
    const editor = mount(p('hello'));
    const box = rulerPageBox(editor.getPageGeometry());

    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
  });

  test('contentBox is the page inset by the margins, so it is strictly inside the sheet', () => {
    const editor = mount(p('hello'));
    const page = editor.getPageGeometry()[0]!;

    expect(page.contentBox.width).toBeLessThan(page.box.width);
    expect(page.contentBox.height).toBeLessThan(page.box.height);
    expect(page.contentBox.x).toBeGreaterThanOrEqual(page.box.x);
  });

  test('grows with the document', () => {
    const editor = mount(p('hello'));
    const before = editor.getPageGeometry().length;

    editor.exec({ type: 'insertBreak', kind: 'page' });

    expect(editor.getPageGeometry().length).toBeGreaterThan(before);
  });

  test('is empty with no document rather than inventing a page', () => {
    const editor = createDocxEditor({});
    expect(editor.getPageGeometry()).toEqual([]);
  });
});

describe('setMode', () => {
  test('view refuses mutating commands on the SAME instance', () => {
    const editor = mount(p('hello'));
    expect(editor.can({ type: 'toggleMark', mark: 'bold' })).toEqual({ ok: true });

    const result = editor.setMode('view');

    expect(result).toEqual({ ok: true, changed: true });
    expect(editor.can({ type: 'toggleMark', mark: 'bold' })).toEqual({
      ok: false,
      code: 'locked',
      reason: 'the document is read-only',
    });
  });

  test('going back to edit re-enables them', () => {
    const editor = mount(p('hello'), { mode: 'view' });
    editor.setMode('edit');

    expect(editor.can({ type: 'toggleMark', mark: 'bold' })).toEqual({ ok: true });
  });

  test('the snapshot reports editable, and a new one is published', () => {
    const editor = mount(p('hello'));
    const before = editor.snapshot();
    expect(before.editable).toBe(true);

    editor.setMode('view');
    const after = editor.snapshot();

    // A NEW snapshot object: controls read `editable` off this, so reusing the cached one
    // would leave every one of them showing the old permission.
    expect(after).not.toBe(before);
    expect(after.editable).toBe(false);
  });

  test('notifies subscribers, so chrome re-derives on the same tick', () => {
    const editor = mount(p('hello'));
    let ticks = 0;
    editor.on('selectionChange', () => {
      ticks += 1;
    });

    editor.setMode('view');

    expect(ticks).toBe(1);
  });

  test('a no-op change reports changed: false and does not notify', () => {
    const editor = mount(p('hello'));
    let ticks = 0;
    editor.on('selectionChange', () => {
      ticks += 1;
    });

    expect(editor.setMode('edit')).toEqual({ ok: true, changed: false });
    expect(ticks).toBe(0);
  });

  test('rejects a value outside the union rather than coercing it', () => {
    const editor = mount(p('hello'));
    const result = editor.setMode('readonly' as 'edit' | 'view');

    expect(result.ok).toBe(false);
    expect(editor.snapshot().editable).toBe(true);
  });

  // The undo history is the reason this is a setter rather than a remount.
  test('keeps the document and its history across a mode round trip', () => {
    const editor = mount(p('hello'));
    editor.exec({ type: 'insertText', text: '!' });
    const revision = editor.snapshot().revision;

    editor.setMode('view');
    editor.setMode('edit');

    expect(editor.snapshot().revision).toBe(revision);
    expect(editor.can({ type: 'undo' })).toEqual({ ok: true });
  });
});

describe('selectionCollapsed', () => {
  test('true at a caret, false over a range', () => {
    const editor = mount(p('hello world'));
    const id = editor.surface!.session.paragraphIds()[0]!;

    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 3 },
      head: { paragraphId: id, offset: 3 },
    });
    expect(editor.snapshot().selectionCollapsed).toBe(true);

    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 0 },
      head: { paragraphId: id, offset: 5 },
    });
    expect(editor.snapshot().selectionCollapsed).toBe(false);
  });

  // The reason this is a snapshot field rather than something derived from `selection`:
  // a range INSIDE one paragraph has the same paraId endpoints as a caret there, so the
  // published `DocRange` cannot tell them apart and the cached snapshot would not re-derive.
  test('changes even when the paraId range does not', () => {
    const editor = mount(p('hello world'));
    const id = editor.surface!.session.paragraphIds()[0]!;

    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 0 },
      head: { paragraphId: id, offset: 5 },
    });
    const ranged = editor.snapshot();

    editor.surface!.setSelection({
      anchor: { paragraphId: id, offset: 5 },
      head: { paragraphId: id, offset: 5 },
    });
    const caret = editor.snapshot();

    expect(caret.selection).toEqual(ranged.selection!);
    expect(ranged.selectionCollapsed).toBe(false);
    expect(caret.selectionCollapsed).toBe(true);
    expect(caret).not.toBe(ranged);
  });

  test('true with no document', () => {
    expect(createDocxEditor({}).snapshot().selectionCollapsed).toBe(true);
  });
});

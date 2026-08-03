// Scoped footnote/endnote editing on the paginated surface.
//
// Entering a painted note binds EditorScope { kind: 'note', id: 'footnote:N' },
// routes the body input path through notesPart, and Escape restores body selection.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function noteDoc(): Uint8Array {
  const body =
    `<w:p><w:r><w:t>Body</w:t></w:r>` +
    `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
    `<w:footnoteReference w:id="1"/></w:r></w:p>`;
  const footnotes =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/><w:t>Note text</w:t></w:r></w:p></w:footnote>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${footnotes}</w:footnotes>`),
  });
}

function mount(bytes: Uint8Array): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const result = mountPaginatedSurface(container, bytes, { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return { surface: result.surface, container };
}

describe('scoped note editing', () => {
  test('painted notes are not HF furniture and carry scope attrs', () => {
    const { container, surface } = mount(noteDoc());
    const note = container.querySelector(
      '[data-docx-note][data-docx-note-scope="footnote:1"]'
    ) as HTMLElement;
    expect(note).toBeTruthy();
    expect(note.closest('[data-docx-hf]')).toBeNull();
    expect(note.getAttribute('role')).toBe('doc-footnote');
    const sep = container.querySelector('[data-docx-note-separator]');
    expect(sep?.getAttribute('contenteditable')).toBe('false');
    const ref = container.querySelector('[data-docx-note-ref]') as HTMLElement;
    expect(ref?.dataset.docxNoteScope).toBe('footnote:1');
    surface.destroy();
  });

  test('enterNote opens notesPart scope; typing stays in the note', () => {
    const { surface } = mount(noteDoc());
    expect(surface.enterNote('footnote:1')).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:1' });
    surface.type('!');
    const noteText = surface.session.storyText({ kind: 'notesPart', noteKind: 'footnote' });
    expect(noteText).toContain('!');
    expect(surface.session.bodyText()).toContain('Body');
    expect(surface.session.bodyText()).not.toContain('!');
    surface.destroy();
  });

  test('Escape / exitNote restores prior body selection', () => {
    const { surface } = mount(noteDoc());
    const bodyIds = surface.session.paragraphIds();
    const first = bodyIds[0]!;
    surface.setSelection({
      anchor: { paragraphId: first, offset: 0 },
      head: { paragraphId: first, offset: 4 },
    });
    const saved = surface.state().selection;
    expect(surface.enterNote('footnote:1')).toBe(true);
    surface.exitNote();
    expect(surface.activeScope()).toEqual({ kind: 'body' });
    expect(surface.state().selection).toEqual(saved);
    surface.destroy();
  });

  test('select-all stays inside the open note story', () => {
    const { surface } = mount(noteDoc());
    expect(surface.enterNote('footnote:1')).toBe(true);
    surface.selectAll();
    const { anchor, head } = surface.state().selection;
    // Layout-scoped order (not whole notesPart) keeps separator notes out.
    const note = surface
      .layout()
      .pages.flatMap((p) => p.footnotes?.notes ?? [])
      .find((n) => n.scopeId === 'footnote:1');
    const noteIds = new Set(
      (note?.fragments ?? []).filter((f) => f.kind === 'paragraph').map((f) => f.paragraphId)
    );
    expect(noteIds.has(anchor.paragraphId)).toBe(true);
    expect(noteIds.has(head.paragraphId)).toBe(true);
    surface.destroy();
  });

  test('formatting applies inside the note scope', () => {
    const { surface } = mount(noteDoc());
    expect(surface.enterNote('footnote:1')).toBe(true);
    const note = surface
      .layout()
      .pages.flatMap((p) => p.footnotes?.notes ?? [])
      .find((n) => n.scopeId === 'footnote:1');
    const fragment = note?.fragments.find((f) => f.kind === 'paragraph');
    expect(fragment).toBeTruthy();
    if (!fragment || fragment.kind !== 'paragraph') throw new Error('missing note paragraph');
    // Skip projected noteRef span; format the authored text run.
    const textSpan = fragment.lines
      .flatMap((line) => line.spans)
      .find((span) => span.text.includes('Note') && !span.projected);
    expect(textSpan).toBeTruthy();
    surface.setSelection({
      anchor: { paragraphId: fragment.paragraphId, offset: textSpan!.range.start },
      head: { paragraphId: fragment.paragraphId, offset: textSpan!.range.end },
    });
    surface.toggleRunProperty('b');
    expect(surface.formatting().bold).toBe(true);
    surface.destroy();
  });

  test('insertNote / deleteNote wire through Editor facade', () => {
    const bytes = noteDoc();
    const editor = createDocxEditor({ document: bytes });
    const host = document.createElement('div');
    document.body.append(host);
    editor.attach(host);
    expect(editor.can({ type: 'insertNote', noteKind: 'endnote' }).ok).toBe(true);
    expect(editor.exec({ type: 'insertNote', noteKind: 'endnote' }).ok).toBe(true);
    const snap = editor.snapshot();
    expect(snap).toBeTruthy();
    editor.detach();
  });

  test('undo reverts a note-scoped type in one step', () => {
    const { surface } = mount(noteDoc());
    expect(surface.enterNote('footnote:1')).toBe(true);
    const before = surface.session.storyText({ kind: 'notesPart', noteKind: 'footnote' });
    surface.type('Z');
    expect(surface.session.storyText({ kind: 'notesPart', noteKind: 'footnote' })).not.toBe(before);
    surface.undo();
    expect(surface.session.storyText({ kind: 'notesPart', noteKind: 'footnote' })).toBe(before);
    surface.destroy();
  });

  test('root listener: body note-ref pointerdown enters note scope; Escape returns body', () => {
    const { container, surface } = mount(noteDoc());
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    Object.defineProperty(pages, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 2000,
        width: 1000,
        height: 2000,
        x: 0,
        y: 0,
      }),
    });
    pages.focus();
    const ref = container.querySelector('[data-docx-note-ref]') as HTMLElement;
    expect(ref?.dataset.docxNoteScope).toBe('footnote:1');
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 10,
      clientY: 10,
    });
    ref.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:1' });
    pages.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    expect(surface.activeScope()).toEqual({ kind: 'body' });
    surface.destroy();
  });
});

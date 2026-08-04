// A scripted edit obeys the same gate a keystroke does.
//
// The browser host writes into a document a person is looking at, and that person's editor has
// modes: viewing refuses every write, suggesting turns one into a proposal attributed to an
// author. A host that reached the session directly would satisfy none of that — it would type
// into a read-only document and write permanent text while the pill said Suggesting, which is
// precisely the failure the surface's one interception point exists to prevent.
//
// The other half is SCOPE. The surface applies an edit to whatever story the reader is in, so
// while a header is open its input path targets the header. An automation handle for a body
// paragraph must not follow the reader in there: the handle names a body paragraph, and it has
// to keep naming one no matter where the caret happens to be.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createBrowserAutomationHost } from '../automation-host.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import type { AutomationHandle, AutomationHost } from '../../automation/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** A document with an optional default header, so scope has somewhere else to go. */
function docx(header?: string): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  const hasHeader = header !== undefined;
  entries['[Content_Types].xml'] = strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      (hasHeader
        ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
        : '') +
      '</Types>'
  );
  entries['_rels/.rels'] = strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  if (hasHeader) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/></Relationships>`
    );
    entries['word/header1.xml'] = strToU8(`<w:hdr xmlns:w="${W}">${header}</w:hdr>`);
  }
  entries['word/document.xml'] = strToU8(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
      `${p('alpha')}${p('beta')}` +
      `<w:sectPr>${hasHeader ? '<w:headerReference w:type="default" r:id="rId10"/>' : ''}</w:sectPr>` +
      '</w:body></w:document>'
  );
  return zipSync(entries);
}

/** A document with one footnote, so the note story has somewhere for a caret to be. */
function noteDocx(): Uint8Array {
  const body =
    `<w:p><w:r><w:t>alpha</w:t></w:r>` +
    `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>` +
    `<w:footnoteReference w:id="1"/></w:r></w:p>`;
  const footnotes =
    `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/><w:t>NOTE</w:t></w:r></w:p></w:footnote>`;
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
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}${p('beta')}<w:sectPr/></w:body></w:document>`
    ),
    'word/footnotes.xml': strToU8(`<w:footnotes xmlns:w="${W}">${footnotes}</w:footnotes>`),
  });
}

function mount(options: { author?: string; header?: string; bytes?: Uint8Array } = {}): {
  editor: DocxEditorInstance;
  container: HTMLElement;
  host: AutomationHost;
} {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: options.bytes ?? docx(options.header),
    ...(options.author === undefined ? {} : { author: options.author }),
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container, host: createBrowserAutomationHost(editor) };
}

function paragraphsOf(host: AutomationHost): readonly AutomationHandle[] {
  const document = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
  const body = handleAt(host.execute({ operations: [{ op: 'getBody', document }] }), 0);
  const listed = host.execute({ operations: [{ op: 'getParagraphs', body }] });
  const result = listed.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'handles') {
    throw new Error('expected paragraph handles');
  }
  return result.value.handles;
}

function handleAt(
  response: { readonly results: readonly { readonly status: string }[] },
  index: number
): AutomationHandle {
  const result = response.results[index] as
    | { status: 'ok'; value: { kind: string; handle: AutomationHandle } }
    | undefined;
  if (result?.status !== 'ok' || result.value.kind !== 'handle') {
    throw new Error(`expected a handle at ${index}`);
  }
  return result.value.handle;
}

function textOf(host: AutomationHost, target: AutomationHandle): string {
  const response = host.execute({ operations: [{ op: 'getText', target }] });
  const result = response.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'text') throw new Error('expected text');
  return result.value.text;
}

function errorAt(
  response: { readonly results: readonly { readonly status: string }[] },
  index: number
): { code: string; detail?: string } {
  const result = response.results[index] as
    | { status: 'error'; error: { code: string; detail?: string } }
    | undefined;
  if (result?.status !== 'error') throw new Error(`expected an error at ${index}`);
  return result.error;
}

/** The main document part of a saved package, as text — where `w:ins` is visible. */
function savedDocumentXml(host: AutomationHost): string {
  const saved = host.save();
  if (!saved.ok) throw new Error(`save failed: ${saved.error.code}`);
  const part = unzipSync(saved.bytes)['word/document.xml'];
  if (!part) throw new Error('saved package has no main document part');
  return new TextDecoder().decode(part);
}

describe('a scripted write obeys the editing mode', () => {
  test('control: in edit mode the write commits, so the refusals below mean something', () => {
    const { host } = mount();
    const paragraphs = paragraphsOf(host);
    const response = host.execute({
      operations: [{ op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'X' }],
    });
    expect({ ok: response.ok, changed: response.changed }).toEqual({ ok: true, changed: true });
    expect(textOf(host, paragraphs[0]!)).toBe('Xalpha');
  });

  test('viewing refuses the write, and nothing about the document moves', () => {
    const { host, editor, container } = mount();
    const paragraphs = paragraphsOf(host);
    editor.surface!.setEditingMode('view');
    const events: number[] = [];
    host.subscribe((event) => events.push(event.revision));
    const before = host.revision();

    const response = host.execute({
      operations: [{ op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'X' }],
    });

    expect({ ok: response.ok, changed: response.changed }).toEqual({ ok: false, changed: false });
    expect(errorAt(response, 0).code).toBe('transaction-refused');
    // The surface's own reason travels through, so a host above this can tell a reader WHY.
    expect(errorAt(response, 0).detail).toContain('viewing');
    expect(textOf(host, paragraphs[0]!)).toBe('alpha');
    expect(host.revision()).toBe(before);
    expect(container.textContent).not.toContain('Xalpha');
    expect(events).toEqual([]);
  });

  test('suggesting with an author proposes the insertion rather than writing it outright', () => {
    const { host, editor } = mount({ author: 'Ada' });
    const paragraphs = paragraphsOf(host);
    editor.surface!.setEditingMode('suggest');

    const response = host.execute({
      operations: [{ op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'Draft' }],
    });

    expect({ ok: response.ok, changed: response.changed }).toEqual({ ok: true, changed: true });
    expect(textOf(host, paragraphs[0]!)).toBe('Draftalpha');
    const xml = savedDocumentXml(host);
    expect(xml).toContain('w:ins');
    expect(xml).toContain('Ada');
  });

  test('suggesting with no author refuses, exactly as a keystroke would', () => {
    // Preserved rather than reinvented: the surface refuses every edit in this state because
    // `CT_TrackChange` has nowhere to put an author, and writing an untracked change instead
    // would edit someone else's document while the review pane stayed empty.
    const { host, editor } = mount();
    const paragraphs = paragraphsOf(host);
    editor.surface!.setEditingMode('suggest');

    const response = host.execute({
      operations: [{ op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'X' }],
    });

    expect(response.ok).toBe(false);
    expect(errorAt(response, 0).code).toBe('transaction-refused');
    expect(errorAt(response, 0).detail).toContain('author');
    expect(textOf(host, paragraphs[0]!)).toBe('alpha');
    expect(savedDocumentXml(host)).not.toContain('w:ins');
  });

  test('a refused mode leaves the editor usable once the mode allows writing again', () => {
    const { host, editor } = mount();
    const paragraphs = paragraphsOf(host);
    editor.surface!.setEditingMode('view');
    host.execute({
      operations: [{ op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'X' }],
    });
    editor.surface!.setEditingMode('edit');
    const response = host.execute({
      operations: [{ op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'Y' }],
    });
    expect(response.ok).toBe(true);
    expect(textOf(host, paragraphs[0]!)).toBe('Yalpha');
  });
});

describe('a body handle names the body, wherever the reader is', () => {
  test('an automation write lands in the body while a header is open for editing', () => {
    const { host, editor } = mount({ header: p('HEADER') });
    const paragraphs = paragraphsOf(host);
    const surface = editor.surface!;
    expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
    expect(surface.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rId10' });

    const response = host.execute({
      operations: [{ op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'B' }],
    });

    expect(response.ok).toBe(true);
    expect(textOf(host, paragraphs[0]!)).toBe('Balpha');
    expect(surface.session.storyText({ kind: 'headerFooter', rId: 'rId10' })).toBe('HEADER');
  });

  test("and the reader's own typing still goes to the header, so scope was not broken", () => {
    // The control for the test above: forcing the body for automation must not force it for
    // the input path, or every header edit would land in the document instead.
    const { host, editor } = mount({ header: p('HEADER') });
    const paragraphs = paragraphsOf(host);
    const surface = editor.surface!;
    surface.enterHeaderFooter({ rId: 'rId10' });
    surface.type('Z');
    expect(surface.session.storyText({ kind: 'headerFooter', rId: 'rId10' })).toContain('Z');
    expect(textOf(host, paragraphs[0]!)).toBe('alpha');
  });
});

describe('a body write does not drag the reader out of the story they are in', () => {
  // The commit that follows a scripted edit re-clamps the caret, because an edit can remove the
  // characters it was sitting in. Clamping against the BODY's paragraphs while the reader is in
  // a header or a note is how a caret ends up naming a paragraph that story does not contain:
  // the scope stays furniture, the caret moves into the document, and the next keystroke is
  // applied to the header story with a body paragraph id — refused as `unknown-paragraph`, so
  // the reader types and nothing happens.

  test('the caret stays put in an open header, and typing still lands there', () => {
    const { host, editor } = mount({ header: p('HEADER') });
    const paragraphs = paragraphsOf(host);
    const surface = editor.surface!;
    surface.enterHeaderFooter({ rId: 'rId10' });
    const headerId = surface.session.paragraphIdsIn({ kind: 'headerFooter', rId: 'rId10' })[0]!;
    surface.setSelection({
      anchor: { paragraphId: headerId, offset: 3 },
      head: { paragraphId: headerId, offset: 3 },
    });
    const caretBefore = surface.state().selection;

    const response = host.execute({
      operations: [{ op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'B' }],
    });
    expect(response.ok).toBe(true);

    expect(surface.activeScope()).toEqual({ kind: 'headerFooter', rId: 'rId10' });
    expect(surface.state().selection).toEqual(caretBefore);

    surface.type('K');
    expect(surface.state().lastRejection).toBeNull();
    expect(surface.session.storyText({ kind: 'headerFooter', rId: 'rId10' })).toBe('HEAKDER');
    // And the scripted edit itself still went to the body, unaffected by the caret's story.
    expect(textOf(host, paragraphs[0]!)).toBe('Balpha');
  });

  test('the caret stays put in an open footnote, and typing still lands there', () => {
    const { host, editor } = mount({ bytes: noteDocx() });
    const paragraphs = paragraphsOf(host);
    const surface = editor.surface!;
    expect(surface.enterNote('footnote:1')).toBe(true);
    const caretBefore = surface.state().selection;
    expect(caretBefore.head.paragraphId).toContain('footnotes.xml');

    const response = host.execute({
      operations: [{ op: 'insertText', paragraph: paragraphs[1]!, offset: 0, text: 'B' }],
    });
    expect(response.ok).toBe(true);

    expect(surface.activeScope()).toEqual({ kind: 'note', id: 'footnote:1' });
    expect(surface.state().selection).toEqual(caretBefore);

    surface.type('!');
    expect(surface.state().lastRejection).toBeNull();
    expect(surface.session.storyText({ kind: 'notesPart', noteKind: 'footnote' })).toContain('!');
    expect(textOf(host, paragraphs[1]!)).toBe('Bbeta');
    expect(textOf(host, paragraphs[0]!)).not.toContain('!');
  });

  test('a body reader is still re-clamped, so the clamp was scoped and not removed', () => {
    // The control. Body selection must keep being clamped by the same commit — dropping the
    // clamp instead of scoping it would leave a caret past the end of a shortened paragraph.
    const { host, editor } = mount();
    const paragraphs = paragraphsOf(host);
    const surface = editor.surface!;
    const bodyId = surface.session.paragraphIds()[0]!;
    surface.setSelection({
      anchor: { paragraphId: bodyId, offset: 5 },
      head: { paragraphId: bodyId, offset: 5 },
    });

    host.execute({
      operations: [{ op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'B' }],
    });

    const { anchor, head } = surface.state().selection;
    expect(anchor.paragraphId).toBe(bodyId);
    expect(head.paragraphId).toBe(bodyId);
    expect(head.offset).toBeLessThanOrEqual(6);
    surface.type('K');
    expect(surface.state().lastRejection).toBeNull();
    expect(textOf(host, paragraphs[0]!)).toContain('K');
  });
});

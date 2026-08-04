// The browser automation host: the same protocol, over the editor that is already open.
//
// The property that matters is what it does NOT do. It creates no document model of its own,
// derives nothing from the painted DOM, and writes through the session's one transaction path
// — so a scripted edit and a typed edit are the same edit, and the painted pages repaint from
// it exactly as they do for a keystroke.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { createBrowserAutomationHost } from '../automation-host.ts';
import type { AutomationHandle, AutomationHost } from '../../automation/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
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
const TWO_PARAGRAPHS = docx(`${p('alpha')}${p('beta')}`);

function mount(): { editor: DocxEditorInstance; container: HTMLElement; host: AutomationHost } {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: TWO_PARAGRAPHS });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { editor, container, host: createBrowserAutomationHost(editor) };
}

function handles(host: AutomationHost): {
  body: AutomationHandle;
  paragraphs: readonly AutomationHandle[];
} {
  const document = handleAt(host.execute({ operations: [{ op: 'getDocument' }] }), 0);
  const body = handleAt(host.execute({ operations: [{ op: 'getBody', document }] }), 0);
  const listed = host.execute({ operations: [{ op: 'getParagraphs', body }] });
  const result = listed.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'handles') {
    throw new Error('expected paragraph handles');
  }
  return { body, paragraphs: result.value.handles };
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

function errorCodeAt(
  response: { readonly results: readonly { readonly status: string }[] },
  index: number
): string {
  const result = response.results[index] as
    | { status: 'error'; error: { code: string } }
    | undefined;
  if (result?.status !== 'error') throw new Error(`expected an error at ${index}`);
  return result.error.code;
}

describe('the browser host over a mounted editor', () => {
  test('it claims the browser-only capabilities the headless host cannot', () => {
    const { host } = mount();
    expect(host.capabilities).toEqual({
      document: true,
      save: true,
      events: true,
      selection: true,
      scrolling: true,
      layout: true,
    });
    expect(Object.isFrozen(host.capabilities)).toBe(true);
  });

  test('it reads the document that is already open', () => {
    const { host } = mount();
    const { body, paragraphs } = handles(host);
    expect(paragraphs).toHaveLength(2);
    expect(textOf(host, body)).toBe('alpha\nbeta');
    expect(textOf(host, paragraphs[1]!)).toBe('beta');
  });

  test('an insert lands in the model AND repaints the pages', () => {
    // The reason this host may not own a model: the painted surface is subscribed to the
    // same session, so one write updates both. A second model would update neither.
    const { host, container, editor } = mount();
    const { paragraphs } = handles(host);
    const before = editor.snapshot();

    const response = host.execute({
      operations: [{ op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'ZZ' }],
    });

    expect({ ok: response.ok, changed: response.changed }).toEqual({ ok: true, changed: true });
    expect(textOf(host, paragraphs[0]!)).toBe('ZZalpha');
    expect(container.textContent).toContain('ZZalpha');
    // And the editor's own observable state moved, so host chrome re-renders too.
    expect(editor.snapshot()).not.toBe(before);
  });

  test('the editor and the host report the same document after either one writes', () => {
    // A typed edit through the facade and a scripted edit through the host are the same
    // edit — which is only true because there is one store behind both.
    const { host, editor } = mount();
    const { paragraphs } = handles(host);
    editor.surface!.selectAll();
    editor.exec({ type: 'insertText', text: 'typed ' });
    expect(textOf(host, paragraphs[0]!)).toContain('typed ');

    host.execute({
      operations: [{ op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: '#' }],
    });
    expect(editor.query({ type: 'selectedText' })).not.toBeUndefined();
    expect(textOf(host, paragraphs[0]!).startsWith('#')).toBe(true);
  });

  test('a refused batch leaves the open document exactly as it was', () => {
    const { host, container } = mount();
    const { paragraphs } = handles(host);
    const response = host.execute({
      operations: [
        { op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'good' },
        { op: 'insertText', paragraph: paragraphs[1]!, offset: 500, text: 'bad' },
      ],
    });
    expect(response.ok).toBe(false);
    expect(errorCodeAt(response, 1)).toBe('invalid-offset');
    expect(textOf(host, paragraphs[0]!)).toBe('alpha');
    expect(container.textContent).not.toContain('good');
  });

  test('a committed batch notifies through the editor, not through a second subscription', () => {
    const { host } = mount();
    const { paragraphs } = handles(host);
    const seen: number[] = [];
    host.subscribe((event) => seen.push(event.revision));
    host.execute({
      operations: [{ op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'x' }],
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(host.revision());
  });

  test('save reaches the same normalizing serializer the editor saves through', async () => {
    const { host, editor } = mount();
    const { paragraphs } = handles(host);
    host.execute({
      operations: [{ op: 'insertText', paragraph: paragraphs[0]!, offset: 5, text: '!' }],
    });
    const saved = host.save();
    expect(saved.ok).toBe(true);
    const viaEditor = await editor.save();
    if (!saved.ok) return;
    expect(saved.bytes.byteLength).toBe(viaEditor.byteLength);
  });
});

describe('a detached or destroyed editor', () => {
  test('a detached editor has no document, and re-attaching gives one back', () => {
    const { host, editor } = mount();
    const { paragraphs } = handles(host);
    host.execute({
      operations: [{ op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'x' }],
    });
    const beforeDetach = host.revision();

    editor.detach();
    const detached = host.execute({ operations: [{ op: 'getDocument' }] });
    expect(detached.ok).toBe(false);
    expect(errorCodeAt(detached, 0)).toBe('document-unavailable');

    editor.attach(document.createElement('div'));
    const reattached = host.execute({ operations: [{ op: 'getDocument' }] });
    expect(reattached.ok).toBe(true);
    // A remount is a fresh session whose own revision restarts, but the host's revision must
    // never go backwards or an expectedRevision from before the detach could be satisfied
    // by coincidence.
    expect(host.revision()).toBeGreaterThan(beforeDetach);
  });

  test('paragraph handles from before a remount are refused rather than silently retargeted', () => {
    const { host, editor } = mount();
    const { paragraphs } = handles(host);
    editor.detach();
    editor.attach(document.createElement('div'));
    const response = host.execute({
      operations: [{ op: 'insertText', paragraph: paragraphs[0]!, offset: 0, text: 'x' }],
    });
    // Either the handle still names a live paragraph (identity survived the remount) or it
    // does not and the host says so. What it must never do is write into a different one.
    if (!response.ok) {
      expect(errorCodeAt(response, 0)).toBe('invalid-handle');
    } else {
      expect(textOf(host, paragraphs[0]!)).toBe('xalpha');
    }
  });

  test('disposing the host does not destroy the editor it borrowed', () => {
    // The host is a lens on someone else's editor. Tearing the editor down with it would
    // make "get me automation over this editor" a destructive call.
    const { host, editor, container } = mount();
    host.dispose();
    expect(host.execute({ operations: [{ op: 'getDocument' }] }).ok).toBe(false);
    expect(editor.surface).not.toBeNull();
    expect(container.textContent).toContain('alpha');
    editor.surface!.selectAll();
    expect(editor.exec({ type: 'toggleMark', mark: 'bold' })).toEqual({ ok: true, changed: true });
  });

  test('a destroyed editor leaves the host answering with a code rather than throwing', () => {
    const { host, editor } = mount();
    handles(host);
    editor.destroy();
    const response = host.execute({ operations: [{ op: 'getDocument' }] });
    expect(response.ok).toBe(false);
    expect(errorCodeAt(response, 0)).toBe('document-unavailable');
    expect(host.save().ok).toBe(false);
  });
});

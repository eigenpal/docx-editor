// A menu Paste after a refused clipboard read pastes the editor's last copy or cut, while that
// copy is still the clipboard content. A selected line and a text box copy from the menu
// (`exec`) and from the keyboard (the `copy` event), and paste from the menu.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { createClipboardHandlers } from '../surface-input.ts';
import { hasEditorClipboardCopy, readClipboardForPaste } from '../clipboard-editor-copy.ts';
import { writeTextToClipboard } from '../clipboard-write.ts';
import { drawingNamed, mount, saved } from './shape-selection-fixture.ts';
import type { AnchoredDrawingRecord } from '../../layout/drawing-layout.ts';

const editors: DocxEditorInstance[] = [];
const named = (xml: string, name: string) => xml.split(`name="${name}"`).length - 1;

/** What the stub clipboard holds, and whether the browser lets the page read it. */
let systemClipboard: { text: string; html: string | null } = { text: '', html: null };
let readAllowed = false;
let writeAllowed = true;
const denied = () => new DOMException('read refused', 'NotAllowedError');
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

beforeEach(() => {
  systemClipboard = { text: 'outside text', html: null };
  readAllowed = false;
  writeAllowed = true;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      write: async () => {
        if (!writeAllowed) throw denied();
      },
      writeText: async () => {
        if (!writeAllowed) throw denied();
      },
      read: async () => {
        if (!readAllowed) throw denied();
        const { text, html } = systemClipboard;
        return [
          {
            types: html ? ['text/plain', 'text/html'] : ['text/plain'],
            getType: async (type: string) => new Blob([type === 'text/html' ? html! : text]),
          },
        ];
      },
      readText: async () => {
        if (!readAllowed) throw denied();
        return systemClipboard.text;
      },
    },
  });
  // A fresh window focus period: no copy from an earlier test survives.
  window.dispatchEvent(new Event('blur'));
});

afterEach(() => {
  // Leave no copy behind for the next test file in a serial run.
  window.dispatchEvent(new Event('blur'));
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
});

async function mounted(): Promise<{ editor: DocxEditorInstance; container: HTMLElement }> {
  const result = await mount();
  editors.push(result.editor);
  return result;
}

function select(editor: DocxEditorInstance, drawing: AnchoredDrawingRecord): void {
  expect(editor.surface!.selectDrawing(drawing.drawingNodeId, drawing.anchorParagraphId)).toBe(
    true
  );
}

function caretAtStart(editor: DocxEditorInstance): void {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 0 },
  });
}

/** Run a menu copy or cut, and let the clipboard write settle. */
async function menuCommand(editor: DocxEditorInstance, type: 'copy' | 'cut') {
  const result = editor.exec({ type });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return result;
}

/** A `copy` event over an in-memory transfer, dispatched where the keyboard copy fires. */
function keyboardCopy(target: Element, data: Map<string, string>): void {
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (kind: string, value: string) => data.set(kind, value),
      getData: (kind: string) => data.get(kind) ?? '',
    },
  });
  target.dispatchEvent(event);
}

/** The menu Paste row: read inside the click, then the paste command. */
async function menuPaste(editor: DocxEditorInstance, owner: Node): Promise<void> {
  const { text, html } = await readClipboardForPaste(owner);
  expect(editor.exec({ type: 'paste', text, ...(html ? { html } : {}) })).toMatchObject({
    ok: true,
  });
}

test('a line copied from the menu pastes from the menu when the clipboard read is refused', async () => {
  const { editor, container } = await mounted();
  select(editor, drawingNamed(editor, 2));
  expect(await menuCommand(editor, 'copy')).toMatchObject({ ok: true });
  expect(hasEditorClipboardCopy(container)).toBe(true);

  caretAtStart(editor);
  await menuPaste(editor, container);
  expect(named(await saved(editor), 'Rule')).toBe(2);
  // The pasted line is selected, ready to move.
  expect(editor.snapshot().image).not.toBeNull();
});

test('a line cut from the menu pastes back from the menu', async () => {
  const { editor, container } = await mounted();
  select(editor, drawingNamed(editor, 2));
  expect(await menuCommand(editor, 'cut')).toMatchObject({ ok: true, changed: true });
  expect(named(await saved(editor), 'Rule')).toBe(0);

  caretAtStart(editor);
  await menuPaste(editor, container);
  expect(named(await saved(editor), 'Rule')).toBe(1);
});

test('a text box copied with the keyboard pastes from the menu with its text', async () => {
  const bytes = new Uint8Array(readFileSync('examples/vite/public/textboxes.docx'));
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: bytes });
  editors.push(editor);
  const surface = editor.surface!;
  select(editor, surface.layout().pages[0]!.anchoredDrawings![0]!);
  // The pages layer runs the keyboard copy; the record follows the event's window.
  const { onCopy } = createClipboardHandlers(surface);
  container.addEventListener('copy', onCopy as EventListener);
  keyboardCopy(container, new Map());
  container.removeEventListener('copy', onCopy as EventListener);
  expect(hasEditorClipboardCopy(container)).toBe(true);

  caretAtStart(editor);
  await menuPaste(editor, container);
  expect(editor.findMatches('Alpha beta gamma')).toHaveLength(2);
});

test('a readable clipboard wins over the editor copy', async () => {
  const { editor, container } = await mounted();
  select(editor, drawingNamed(editor, 2));
  await menuCommand(editor, 'copy');
  readAllowed = true;
  expect(await readClipboardForPaste(container)).toEqual({ text: 'outside text', html: null });
});

test('the window losing focus forgets the editor copy, so the refusal stands', async () => {
  const { editor, container } = await mounted();
  select(editor, drawingNamed(editor, 2));
  await menuCommand(editor, 'copy');
  // Another application can copy only while it has focus.
  window.dispatchEvent(new Event('blur'));
  expect(hasEditorClipboardCopy(container)).toBe(false);
  await expect(readClipboardForPaste(container)).rejects.toMatchObject({
    name: 'NotAllowedError',
  });
});

test('a hidden page forgets the editor copy', async () => {
  const { editor, container } = await mounted();
  select(editor, drawingNamed(editor, 2));
  await menuCommand(editor, 'copy');
  const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  if (visibility) Object.defineProperty(document, 'visibilityState', visibility);
  else delete (document as { visibilityState?: unknown }).visibilityState;
  expect(hasEditorClipboardCopy(container)).toBe(false);
});

test('a copy outside the editor forgets the editor copy', async () => {
  const { editor, container } = await mounted();
  select(editor, drawingNamed(editor, 2));
  await menuCommand(editor, 'copy');
  const field = document.createElement('textarea');
  document.body.append(field);
  keyboardCopy(field, new Map());
  expect(hasEditorClipboardCopy(container)).toBe(false);
});

test('paste without formatting reads only the text of the editor copy', async () => {
  const { editor, container } = await mounted();
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 3 },
  });
  const copied = editor.surface!.copyFlavours().text;
  expect(copied).not.toBe('');
  await menuCommand(editor, 'copy');
  expect(await readClipboardForPaste(container, { plainText: true })).toEqual({
    text: copied,
    html: null,
  });
});

test('a refused clipboard write records nothing and forgets the previous copy', async () => {
  const { editor, container } = await mounted();
  select(editor, drawingNamed(editor, 2));
  await menuCommand(editor, 'copy');
  expect(hasEditorClipboardCopy(container)).toBe(true);
  // The clipboard keeps its earlier content, which the editor does not know.
  writeAllowed = false;
  await menuCommand(editor, 'copy');
  expect(hasEditorClipboardCopy(container)).toBe(false);
  await expect(readClipboardForPaste(container)).rejects.toMatchObject({
    name: 'NotAllowedError',
  });
});

test('a shape copy has no text to paste without formatting', async () => {
  const { editor, container } = await mounted();
  select(editor, drawingNamed(editor, 2));
  await menuCommand(editor, 'copy');
  expect(hasEditorClipboardCopy(container)).toBe(true);
  expect(hasEditorClipboardCopy(container, { plainText: true })).toBe(false);
  await expect(readClipboardForPaste(container, { plainText: true })).rejects.toMatchObject({
    name: 'NotAllowedError',
  });
});

test('text written through writeTextToClipboard replaces the editor copy', async () => {
  const { editor, container } = await mounted();
  select(editor, drawingNamed(editor, 2));
  await menuCommand(editor, 'copy');
  await writeTextToClipboard(container, 'https://example.com/');
  expect(await readClipboardForPaste(container)).toEqual({
    text: 'https://example.com/',
    html: null,
  });
  writeAllowed = false;
  await expect(writeTextToClipboard(container, 'other')).rejects.toMatchObject({
    name: 'NotAllowedError',
  });
  expect(hasEditorClipboardCopy(container)).toBe(false);
});

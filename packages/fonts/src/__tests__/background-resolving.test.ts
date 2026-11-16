// `fontMeasurement().resolving` turns false when the text shows in its own fonts. The other
// faces that `loading: 'progressive'` loads in the background do not hold it, so a host that
// shows a spinner until fonts resolve hides it as soon as the text is ready.
import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { packagedFonts } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const assetsDir = new URL('../../assets/', import.meta.url);

const bytes = zipSync({
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
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r>` +
      '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr>' +
      '<w:t>ready text</w:t></w:r></w:p></w:body></w:document>'
  ),
});

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});

async function until(condition: () => boolean, ms = 8_000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((settle) => setTimeout(settle, 10));
  }
}

const installed = (editor: DocxEditorInstance, bold: boolean) =>
  editor.surface?.textMeasurer?.().hasResolvedFont?.({
    fontFamily: 'Times New Roman',
    bold,
    italic: false,
  } as never) === true;

test('background faces do not keep fonts resolving once the text shows in its own fonts', async () => {
  // Every face but the regular ones waits until the test lets it through.
  let release!: () => void;
  const gate = new Promise<void>((settle) => (release = settle));
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const file = url.slice(url.lastIndexOf('/') + 1);
    if (!file.includes('Regular')) await gate;
    return new Response(new Uint8Array(readFileSync(new URL(file, assetsDir))));
  }) as typeof fetch;
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ document: bytes, fonts: packagedFonts({ fetcher }) });
  cleanup.push(() => (editor.destroy(), container.remove()));
  editor.attach(container);

  await until(() => installed(editor, false) && !editor.fontMeasurement().resolving);
  // The bold face is still on the way, and the text is ready.
  expect(installed(editor, true)).toBe(false);
  expect(editor.fontMeasurement().measurer).toBe('shaped');

  release();
  await until(() => installed(editor, true));
  expect(editor.fontMeasurement().resolving).toBe(false);
}, 20_000);

// A user picks a family that the resolver has not loaded yet. Until its face arrives, the
// picked text keeps the face it had: same width, no fallback face, and no substitution
// notice. When the face arrives, the text changes once, to the picked family.
import './dom-setup.ts';

import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { caretAt, linesOf } from '@docx-editor.dev/core/layout';
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
      '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr>' +
      '<w:t>picked text stays</w:t></w:r></w:p></w:body></w:document>'
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

/**
 * The advance of the picked word and the space after it. Inside one run the caret position is
 * interpolated, so the measure ends at a run edge on both sides of the pick.
 */
const pickedWidth = (editor: DocxEditorInstance): number => {
  const layout = editor.surface!.layout();
  const paragraphId = linesOf(layout)[0]!.spans[0]!.range.paragraphId;
  const x = (offset: number) => caretAt(layout, { paragraphId, offset })!.x;
  return x(7) - x(0);
};

test('a picked family that is still loading keeps the face the text had', async () => {
  // Caladea (the packaged Cambria) waits until the test lets it through.
  let release!: () => void;
  const gate = new Promise<void>((settle) => (release = settle));
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const file = url.slice(url.lastIndexOf('/') + 1);
    if (file.startsWith('Caladea')) await gate;
    return new Response(new Uint8Array(readFileSync(new URL(file, assetsDir))));
  }) as typeof fetch;
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    document: bytes,
    fonts: packagedFonts({ fetcher, loading: 'lazy' }),
  });
  cleanup.push(() => (editor.destroy(), container.remove()));
  editor.attach(container);
  await until(
    () => !editor.fontMeasurement().resolving && editor.fontMeasurement().measurer === 'shaped'
  );

  const paragraphId = linesOf(editor.surface!.layout())[0]!.spans[0]!.range.paragraphId;
  const range = { anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 6 } };
  const before = pickedWidth(editor);
  expect(editor.exec({ type: 'setSelection', range }).ok).toBe(true);
  expect(
    editor.exec({ type: 'setMarkAttr', mark: 'fontFamily', attr: 'family', value: 'Cambria' }).ok
  ).toBe(true);
  expect(pickedWidth(editor)).toBeCloseTo(before, 3);
  expect(editor.snapshot().fontSubstitutions ?? []).toEqual([]);
  await new Promise((settle) => setTimeout(settle, 50));
  expect(pickedWidth(editor)).toBeCloseTo(before, 3);
  expect(editor.snapshot().fontSubstitutions ?? []).toEqual([]);

  release();
  await until(() => Math.abs(pickedWidth(editor) - before) > 0.5);
  expect(editor.snapshot().fontSubstitutions ?? []).toEqual([]);
}, 20_000);

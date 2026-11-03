/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A compare in the editor installs the revised style definitions with the redline, and the one
// undo step of the compare restores the original definitions.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { p } from '../../../../../scripts/compare-corpus/xml.ts';
import { reviewModule } from '../../index.ts';

const STYLE = (color: string) =>
  `<w:style w:type="paragraph" w:customStyle="1" w:styleId="Mine"><w:name w:val="Mine"/>` +
  `<w:rPr><w:color w:val="${color}"/></w:rPr></w:style>`;
const document_ = (text: string, color: string) =>
  buildDocx({
    body: p('Styled words', '<w:pStyle w:val="Mine"/>') + p(text),
    extraStyles: STYLE(color),
  });

let editor: DocxEditorInstance | undefined;
let container: HTMLElement | undefined;
afterEach(() => {
  editor?.destroy();
  container?.remove();
  editor = container = undefined;
});

async function savedStyles(instance: DocxEditorInstance): Promise<string> {
  const bytes = new Uint8Array(await instance.save());
  return strFromU8(unzipSync(bytes)['word/styles.xml']!);
}

test('the compare step brings the revised definitions, and undo takes them back', async () => {
  container = document.createElement('div');
  document.body.append(container);
  editor = createDocxEditor({
    container,
    document: document_('Old text', 'FF0000'),
    author: 'Reviewer',
    modules: [reviewModule()],
  });
  const result = editor.exec({
    type: 'compareDocuments',
    revised: document_('New text', '0000FF'),
  });
  expect(result).toMatchObject({ ok: true, changed: true });
  expect(await savedStyles(editor)).toContain('w:val="0000FF"');

  expect(editor.exec({ type: 'undo' }).ok).toBe(true);
  const restored = await savedStyles(editor);
  expect(restored).toContain('w:val="FF0000"');
  expect(restored).not.toContain('w:val="0000FF"');
});

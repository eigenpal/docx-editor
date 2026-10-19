/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A large document takes input while its later pages still lay out. A page field updated then
// must read the whole pagination, not the pages laid out so far.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor as DocxEditorBrowser } from '../../browser.ts';
import { docx } from './support/docx.ts';

const words = ' with enough ordinary words to wrap over several lines of a page'.repeat(3);

function largeDocument(): Uint8Array {
  const body: string[] = [
    '<w:p><w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>',
  ];
  for (let index = 0; index < 3000; index += 1) {
    body.push(`<w:p><w:r><w:t>Paragraph ${index}${words}</w:t></w:r></w:p>`);
  }
  return docx(body.join('') + '<w:sectPr/>');
}

test('a page field updated during the opening counts every page', async () => {
  const editor = createDocxEditor({ document: largeDocument() });
  const pendingAtUpdate = new Promise<boolean>((resolve) => {
    const off = editor.on('change', () => {
      if (!editor.surface) return;
      off();
      const container = document.querySelector('[data-docx-test-host]')!;
      resolve(container.hasAttribute('data-docx-layout-pending'));
    });
  });
  const container = document.createElement('div');
  container.setAttribute('data-docx-test-host', '');
  document.body.append(container);
  editor.attach(container);
  try {
    // Updated in the mount's own task, before any background slice runs.
    expect(await pendingAtUpdate).toBe(true);
    const runtime = DocxEditorBrowser.createBrowser(editor);
    let pendingInRun = false;
    await runtime.run(async (context) => {
      pendingInRun = container.hasAttribute('data-docx-layout-pending');
      const field = context.document.body.fields.getFirst();
      await context.sync();
      field.updateResult();
      await context.sync();
    });
    expect(pendingInRun).toBe(true);
    const pages = editor.surface!.layout().pages.length;
    expect(pages).toBeGreaterThan(20);
    expect(container.hasAttribute('data-docx-layout-pending')).toBe(false);
    const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
    const cached = xml.match(/NUMPAGES[^>]*>[\s\S]*?<w:t[^>]*>(\d+)<\/w:t>/)?.[1];
    expect(cached).toBe(String(pages));
  } finally {
    editor.destroy();
    container.remove();
  }
}, 120_000);

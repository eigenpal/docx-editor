/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A browser runtime runs over the editor's own store, so it meets the host's
// `contentLockPolicy`. Without the option a font write inside a `cannotEdit` control refuses, as
// in Word. With it the write applies, and a text write still refuses.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import type { ContentLockPolicy } from '@docx-editor.dev/core';
import { DocxEditor as DocxEditorBrowser } from '../../browser.ts';
import type { RequestContext } from '../../index.ts';
import { docx } from './support/docx.ts';

const SAMPLE =
  '<w:p><w:r><w:t xml:space="preserve">head </w:t></w:r><w:sdt><w:sdtPr><w:tag w:val="t"/>' +
  '<w:lock w:val="sdtContentLocked"/></w:sdtPr><w:sdtContent><w:r><w:t>TOKEN</w:t></w:r>' +
  '</w:sdtContent></w:sdt><w:r><w:t xml:space="preserve"> tail</w:t></w:r></w:p>';

async function token(c: RequestContext) {
  const matches = c.document.body.search('TOKEN', { matchCase: true });
  matches.load('items');
  await c.sync();
  return matches.items[0]!;
}

function mount(contentLockPolicy?: ContentLockPolicy) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docx(SAMPLE),
    ...(contentLockPolicy ? { contentLockPolicy } : {}),
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  const runtime = DocxEditorBrowser.createBrowser(editor);
  return {
    runtime,
    dispose() {
      runtime.dispose();
      editor.destroy();
      container.remove();
    },
  };
}

test('without the policy a font write inside a content-locked control refuses', async () => {
  const mounted = mount();
  try {
    await mounted.runtime.run(async (c) => {
      (await token(c)).font.bold = true;
      await expect(c.sync()).rejects.toMatchObject({ code: 'GeneralException' });
    });
  } finally {
    mounted.dispose();
  }
});

test('with the policy a font write applies and a text write still refuses', async () => {
  const mounted = mount({ allowFormattingInLockedContent: true });
  try {
    await mounted.runtime.run(async (c) => {
      const range = await token(c);
      range.font.bold = true;
      await c.sync();
      range.font.load('bold');
      await c.sync();
      expect(range.font.bold).toBe(true);
    });
    await mounted.runtime.run(async (c) => {
      (await token(c)).insertText('X', 'Replace');
      await expect(c.sync()).rejects.toMatchObject({ code: 'InvalidArgument' });
    });
  } finally {
    mounted.dispose();
  }
});

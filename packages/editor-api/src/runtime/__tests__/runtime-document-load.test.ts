/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../../index.ts';
import { DocxEditor as DocxEditorBrowser } from '../../browser.ts';
import { docx, p } from './support/docx.ts';

const bytes = docx(p('Original'));

for (const host of ['browser', 'server'] as const) {
  test(`${host} default document loads preserve other reads and writes`, async () => {
    const editor =
      host === 'browser'
        ? createDocxEditor({ container: document.createElement('div'), document: bytes })
        : undefined;
    const runtime = editor
      ? DocxEditorBrowser.createBrowser(editor)
      : await DocxEditor.createServer(bytes);
    try {
      await runtime.run(async (context) => {
        context.document.load();
        context.document.body.load('text');
        await context.sync();
        expect(context.document.body.text).toBe('Original');
        expect(() => context.document.changeTrackingMode).toThrow(
          expect.objectContaining({ code: 'PropertyNotLoaded' })
        );

        context.document.load({});
        context.document.body.insertText(' added', 'End');
        await context.sync();
        context.document.body.load('text');
        await context.sync();
        expect(context.document.body.text).toBe('Original added');
      });
    } finally {
      runtime.dispose();
      editor?.destroy();
    }
  });
}

test('browser explicit tracking loads and assignments still refuse', async () => {
  const editor = createDocxEditor({ container: document.createElement('div'), document: bytes });
  const runtime = DocxEditorBrowser.createBrowser(editor, { author: 'Agent' });
  try {
    await runtime.run(async (context) => {
      context.document.load('changeTrackingMode');
      await expect(context.sync()).rejects.toMatchObject({
        code: 'NotSupported',
        target: 'document.changeTrackingMode',
      });
      for (const mode of ['Off', 'TrackMineOnly', 'TrackAll'] as const) {
        context.document.changeTrackingMode = mode;
        await expect(context.sync()).rejects.toMatchObject({
          code: 'NotSupported',
          target: 'document.changeTrackingMode',
        });
      }
    });
  } finally {
    runtime.dispose();
    editor.destroy();
  }
});

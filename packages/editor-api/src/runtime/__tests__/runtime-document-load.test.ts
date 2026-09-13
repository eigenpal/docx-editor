/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '../../index.ts';
import { DocxEditor as DocxEditorBrowser } from '../../browser.ts';
import { reviewModule } from '../../../../pro/src/review/review-module.ts';
import { strFromU8, unzipSync } from 'fflate';
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

test('browser tracks local mode while refusing TrackAll', async () => {
  const editor = createDocxEditor({ container: document.createElement('div'), document: bytes });
  const runtime = DocxEditorBrowser.createBrowser(editor, { author: 'Agent' });
  try {
    await runtime.run(async (context) => {
      context.document.load('changeTrackingMode');
      await context.sync();
      expect(context.document.changeTrackingMode).toBe('Off');
      context.document.changeTrackingMode = 'TrackMineOnly';
      await context.sync();
      expect(context.document.changeTrackingMode).toBe('TrackMineOnly');
      context.document.changeTrackingMode = 'TrackAll';
      await expect(context.sync()).rejects.toMatchObject({ code: 'NotSupported' });
      context.document.body.getRange('End').insertText(' tracked', 'End');
      await expect(context.sync()).rejects.toMatchObject({ code: 'NotSupported' });
    });
  } finally {
    runtime.dispose();
    editor.destroy();
  }
});

test('browser runtime tracking writes real revisions and rejects them through the public API', async () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: bytes,
    modules: [reviewModule()],
  });
  const runtime = DocxEditorBrowser.createBrowser(editor, { author: 'Document agent' });
  try {
    await runtime.run(async (context) => {
      context.document.changeTrackingMode = 'TrackMineOnly';
      await context.sync();
      context.document.body.getRange('End').insertText(' proposed', 'End');
      await context.sync();
    });
    const saved = new Uint8Array(await editor.save());
    expect(strFromU8(unzipSync(saved)['word/document.xml']!)).toContain('<w:ins');
    expect(strFromU8(unzipSync(saved)['word/document.xml']!)).toContain('Document agent');
    await runtime.run(async (context) => {
      context.document.revisions.rejectAll();
      await context.sync();
      context.document.body.load('text');
      await context.sync();
      expect(context.document.body.text).toBe('Original');
    });
  } finally {
    runtime.dispose();
    editor.destroy();
  }
});

for (const action of ['list', 'table', 'field', 'control'] as const) {
  test(`browser suggesting mode refuses permanent ${action} writes even with runtime tracking Off`, async () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: bytes,
      modules: [reviewModule()],
      author: 'UI reviewer',
    });
    editor.setEditingMode('suggesting');
    const runtime = DocxEditorBrowser.createBrowser(editor, { author: 'Agent' });
    const before = new Uint8Array(await editor.save());
    try {
      expect(editor.getEditingMode()).toBe('suggesting');
      await expect(
        runtime.run(async (context) => {
          if (action === 'list') context.document.body.paragraphs.getFirst().startNewList();
          else if (action === 'table')
            context.document.body.getRange('Start').insertTable(1, 1, 'After', [['Permanent?']]);
          else if (action === 'field')
            context.document.body.getRange('Start').insertField('After', 'Page');
          else context.document.body.getRange('Start').insertContentControl('PlainText');
          await context.sync();
        })
      ).rejects.toMatchObject({ code: 'NotSupported' });
      expect(new Uint8Array(await editor.save())).toEqual(before);
    } finally {
      runtime.dispose();
      editor.destroy();
    }
  });
}

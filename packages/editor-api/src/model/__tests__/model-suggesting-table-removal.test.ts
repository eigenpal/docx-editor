/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A browser editor in suggesting mode has no tracked form for deleting a whole table. A body
// write that would remove one refuses with the stable `NotSupported` code and changes nothing.
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { reviewModule } from '@docx-editor.dev/pro';
import { createBrowser } from '../../runtime/browser.ts';
import type { RequestContext } from '../../runtime/request-context.ts';
import { cell, docx, p, row, table } from './support/documents.ts';

const bytes = docx(
  `${p('before')}${table('<w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>' + row(cell(p('cell'))))}${p('after')}`
);

const writes: readonly [string, (context: RequestContext) => void][] = [
  ['Body.clear', (context) => context.document.body.clear()],
  ['Body.insertText Replace', (context) => context.document.body.insertText('x', 'Replace')],
  ['Table.delete', (context) => context.document.body.tables.getFirst().delete()],
];

for (const [name, write] of writes) {
  test(`suggesting: ${name} over a body with a table refuses with NotSupported`, async () => {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: bytes,
      modules: [reviewModule()],
      author: 'Reviewer',
    });
    editor.setEditingMode('suggesting');
    const runtime = createBrowser(editor, { author: 'Agent' });
    try {
      const failure = await runtime.run(async (context) => {
        write(context);
        return context.sync().then(
          () => null,
          (error: unknown) => error
        );
      });
      expect(failure).toMatchObject({ code: 'NotSupported' });
      await runtime.run(async (context) => {
        const tables = context.document.body.tables.load('items');
        const paragraphs = context.document.body.paragraphs.load('items/text');
        await context.sync();
        expect(tables.items).toHaveLength(1);
        expect(paragraphs.items.map((paragraph) => paragraph.text)).toEqual([
          'before',
          'cell',
          'after',
        ]);
      });
      const parts = unzipSync(new Uint8Array(await editor.save()));
      const xml = strFromU8(parts['word/document.xml'] as Uint8Array);
      expect(xml).toContain('<w:tbl>');
      expect(xml).not.toContain('<w:del ');
    } finally {
      runtime.dispose();
      editor.destroy();
    }
  });
}

test('suggesting: Body.clear names the tracked-structure diagnostic', async () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: bytes,
    modules: [reviewModule()],
    author: 'Reviewer',
  });
  editor.setEditingMode('suggesting');
  const runtime = createBrowser(editor, { author: 'Agent' });
  try {
    const failure = await runtime.run(async (context) => {
      context.document.body.clear();
      return context.sync().then(
        () => null,
        (error: unknown) => error
      );
    });
    expect(failure).toMatchObject({
      code: 'NotSupported',
      debugInfo: { innerError: { code: 'edit.tracked-structure-unsupported' } },
    });
  } finally {
    runtime.dispose();
    editor.destroy();
  }
});

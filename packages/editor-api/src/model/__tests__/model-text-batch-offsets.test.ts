/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { reviewModule } from '@docx-editor.dev/pro';
import { createBrowser } from '../../runtime/browser.ts';
import { docx, mainXmlOf, p, serverRuntime } from './support/documents.ts';

const source = 'Signed by {{signer}} on {{date}}.';
const bytes = docx(p(source));

for (const reverse of [false, true])
  for (const browser of [false, true]) {
    test(`disjoint replacements rebase operations and returned ranges: reverse=${reverse}, browser=${browser}`, async () => {
      const container = document.createElement('div');
      const editor = browser ? createDocxEditor({ container, document: bytes }) : null;
      const server = editor ? null : await serverRuntime(bytes);
      const runtime = editor ? createBrowser(editor) : server!;
      try {
        await runtime.run(async (context) => {
          const name = context.document.body.search('{{signer}}').getFirst();
          const date = context.document.body.search('{{date}}').getFirst();
          const targets = reverse ? [date, name] : [name, date];
          const texts = reverse
            ? ['13 September 2026', 'Ada Lovelace']
            : ['Ada Lovelace', '13 September 2026'];
          const inserted = targets.map((target, i) => target.insertText(texts[i]!, 'Replace'));
          await context.sync();
          for (const range of inserted) range.load('text');
          context.document.body.load('text');
          await context.sync();
          expect(inserted.map((range) => range.text)).toEqual(texts);
          expect(context.document.body.text).toBe('Signed by Ada Lovelace on 13 September 2026.');
          inserted[0]!.font.bold = true;
          await context.sync();
          inserted[0]!.font.load('bold');
          inserted[1]!.font.load('bold');
          await context.sync();
          expect(inserted[0]!.font.bold).toBe(true);
          expect(inserted[1]!.font.bold).toBeNull();
        });
        const saved = editor ? new Uint8Array(await editor.save()) : await server!.save();
        const reopened = await serverRuntime(saved);
        try {
          await reopened.run(async (context) => {
            context.document.body.load('text');
            await context.sync();
            expect(context.document.body.text).toBe('Signed by Ada Lovelace on 13 September 2026.');
          });
        } finally {
          reopened.dispose();
        }
      } finally {
        runtime.dispose();
        editor?.destroy();
      }
    });
  }

test('two insertions at one source point retain call order and separate result ranges', async () => {
  const runtime = await serverRuntime(docx(p('ab')));
  try {
    await runtime.run(async (context) => {
      const anchor = context.document.body.search('b').getFirst();
      const first = anchor.insertText('ONE', 'Before');
      const second = anchor.insertText('TWO', 'Before');
      await context.sync();
      first.load('text');
      second.load('text');
      context.document.body.load('text');
      await context.sync();
      expect(first.text).toBe('ONE');
      expect(second.text).toBe('TWO');
      expect(context.document.body.text).toBe('aONETWOb');
    });
  } finally {
    runtime.dispose();
  }
});

for (const location of ['Start', 'End'] as const) {
  test(`paragraph ${location} insertions retain endpoint semantics and result ranges`, async () => {
    const runtime = await serverRuntime(docx(p('alpha')));
    try {
      await runtime.run(async (context) => {
        const paragraph = context.document.body.paragraphs.getFirst();
        const first = paragraph.insertText(' one ', location);
        const second = paragraph.insertText(' two ', location);
        await context.sync();
        first.load('text');
        second.load('text');
        paragraph.load('text');
        await context.sync();
        expect(first.text).toBe(' one ');
        expect(second.text).toBe(' two ');
        expect(paragraph.text).toBe(location === 'Start' ? ' two  one alpha' : 'alpha one  two ');
      });
    } finally {
      runtime.dispose();
    }
  });
}

for (const reverse of [false, true])
  test(`adjacent replacement and insertion boundaries rebase: reverse=${reverse}`, async () => {
    const runtime = await serverRuntime(docx(p('ABCDEF')));
    try {
      await runtime.run(async (context) => {
        const left = context.document.body.search('ABC').getFirst();
        const right = context.document.body.search('DEF').getFirst();
        const values = reverse
          ? [right.insertText('R', 'Replace'), left.insertText('LLLL', 'Replace')]
          : [left.insertText('LLLL', 'Replace'), right.insertText('R', 'Replace')];
        await context.sync();
        for (const value of values) value.load('text');
        context.document.body.load('text');
        await context.sync();
        expect(context.document.body.text).toBe('LLLLR');
        expect(values.map((value) => value.text)).toEqual(reverse ? ['R', 'LLLL'] : ['LLLL', 'R']);
      });
    } finally {
      runtime.dispose();
    }
  });

for (const reverse of [false, true])
  for (const other of ['overlap', 'font', 'paragraph', 'hyperlink'] as const) {
    test(`incompatible changes refuse atomically: ${other}, reverse=${reverse}`, async () => {
      const runtime = await serverRuntime(bytes);
      try {
        const before = await mainXmlOf(runtime);
        await expect(
          runtime.run(async (context) => {
            const name = context.document.body.search('{{signer}}').getFirst();
            const otherRange = context.document.body.search('signer').getFirst();
            await context.sync();
            const replace = () => name.insertText('Ada', 'Replace');
            const incompatible = () => {
              if (other === 'overlap') otherRange.insertText('NAME', 'Replace');
              else if (other === 'font') otherRange.font.bold = true;
              else if (other === 'paragraph') otherRange.insertParagraph('Extra', 'After');
              else otherRange.hyperlink = 'https://example.com';
            };
            if (reverse) {
              incompatible();
              replace();
            } else {
              replace();
              incompatible();
            }
            await context.sync();
          })
        ).rejects.toMatchObject({ code: 'ConflictingChanges' });
        expect(await mainXmlOf(runtime)).toBe(before);
      } finally {
        runtime.dispose();
      }
    });
  }

test('browser suggesting mode refuses multiple replacements without changing the document', async () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: bytes,
    modules: [reviewModule()],
    author: 'Reviewer',
  });
  editor.setEditingMode('suggesting');
  const runtime = createBrowser(editor, { author: 'Agent' });
  const before = new Uint8Array(await editor.save());
  try {
    await expect(
      runtime.run(async (context) => {
        context.document.body.search('{{signer}}').getFirst().insertText('Ada', 'Replace');
        context.document.body.search('{{date}}').getFirst().insertText('Today', 'Replace');
        await context.sync();
      })
    ).rejects.toMatchObject({ code: 'ConflictingChanges' });
    expect(new Uint8Array(await editor.save())).toEqual(before);
  } finally {
    runtime.dispose();
    editor.destroy();
  }
});

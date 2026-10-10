/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { docx, serverRuntime } from './support/documents.ts';

const plain = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const bold = (text: string) =>
  `<w:r><w:rPr><w:b/><w:color w:val="143B52"/></w:rPr><w:t>${text}</w:t></w:r>`;

const promptDocument = docx(
  '<w:sdt><w:sdtPr><w:alias w:val="Value"/><w:tag w:val="field"/>' +
    '<w:id w:val="1"/><w:showingPlcHdr/><w:text/></w:sdtPr><w:sdtContent><w:p>' +
    plain('Enter name') +
    '</w:p></w:sdtContent></w:sdt>'
);

test('full block-control prompt replacement consumes the prompt once and survives reopening', async () => {
  const runtime = await serverRuntime(promptDocument);
  try {
    await runtime.run(async (context) => {
      const result = context.document.body
        .search('Enter name')
        .getFirst()
        .insertText('Ada', 'Replace');
      await context.sync();
      result.load('text');
      context.document.body.load('text');
      await context.sync();
      expect(result.text).toBe('Ada');
      expect(context.document.body.text).toBe('Ada');
    });
    const reopened = await serverRuntime(await runtime.save());
    try {
      await reopened.run(async (context) => {
        context.document.body.load('text');
        await context.sync();
        expect(context.document.body.text).toBe('Ada');
      });
    } finally {
      reopened.dispose();
    }
  } finally {
    runtime.dispose();
  }
});

test('partial prompt replacement refuses before consuming unrelated prompt text', async () => {
  const runtime = await serverRuntime(promptDocument);
  try {
    await expect(
      runtime.run(async (context) => {
        context.document.body.search('name').getFirst().insertText('Ada', 'Replace');
        await context.sync();
      })
    ).rejects.toMatchObject({ code: 'NotSupported' });
    await runtime.run(async (context) => {
      context.document.body.load('text');
      await context.sync();
      expect(context.document.body.text).toBe('Enter name');
    });
  } finally {
    runtime.dispose();
  }
});

test('insertion within a block prompt refuses before losing prompt text or returning invalid offsets', async () => {
  const runtime = await serverRuntime(promptDocument);
  try {
    await expect(
      runtime.run(async (context) => {
        context.document.body.search('name').getFirst().insertText('Ada', 'Before');
        await context.sync();
      })
    ).rejects.toMatchObject({ code: 'NotSupported' });
    await runtime.run(async (context) => {
      context.document.body.load('text');
      await context.sync();
      expect(context.document.body.text).toBe('Enter name');
      const result = context.document.body
        .search('Enter name')
        .getFirst()
        .insertText('Ada', 'Before');
      await context.sync();
      result.load('text');
      context.document.body.load('text');
      await context.sync();
      expect(result.text).toBe('Ada');
      expect(context.document.body.text).toBe('Ada');
    });
  } finally {
    runtime.dispose();
  }
});

for (const variant of ['whole', 'run-boundary', 'partial-run', 'hyperlink', 'bookmark'] as const) {
  test(`replacement preserves target font and returned range: ${variant}`, async () => {
    const target = variant === 'partial-run' ? bold('beforeTESTafter') : bold('TEST');
    const wrapped =
      variant === 'hyperlink'
        ? `<w:hyperlink w:anchor="local">${target}</w:hyperlink>`
        : variant === 'bookmark'
          ? `<w:bookmarkStart w:id="1" w:name="local"/>${target}<w:bookmarkEnd w:id="1"/>`
          : target;
    const body = variant === 'whole' ? wrapped : plain('Prefix ') + wrapped + plain(' suffix');
    const runtime = await serverRuntime(docx(`<w:p>${body}</w:p>`));
    try {
      await runtime.run(async (context) => {
        const replacement = context.document.body
          .search('TEST')
          .getFirst()
          .insertText('NEW VALUE', 'Replace');
        await context.sync();
        replacement.load('text');
        replacement.font.load('bold,color');
        const prefix =
          variant === 'whole' ? null : context.document.body.search('Prefix').getFirst();
        prefix?.font.load('bold');
        await context.sync();
        expect(replacement.text).toBe('NEW VALUE');
        expect(replacement.font.bold).toBe(true);
        expect(replacement.font.color).toBe('#143B52');
        if (prefix) expect(prefix.font.bold).toBeNull();
      });
      const reopened = await serverRuntime(await runtime.save());
      try {
        await reopened.run(async (context) => {
          const result = context.document.body.search('NEW VALUE').getFirst();
          result.load('text');
          result.font.load('bold,color');
          context.document.body.load('text');
          await context.sync();
          expect(result.text).toBe('NEW VALUE');
          expect(result.font.bold).toBe(true);
          expect(result.font.color).toBe('#143B52');
          expect(context.document.body.text).toBe(
            variant === 'whole'
              ? 'NEW VALUE'
              : variant === 'partial-run'
                ? 'Prefix beforeNEW VALUEafter suffix'
                : 'Prefix NEW VALUE suffix'
          );
        });
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
}

test('batched replacements inherit each source target font after rebasing', async () => {
  const runtime = await serverRuntime(
    docx(
      `<w:p>${plain('one ')}${bold('TEST')}${plain(' two ')}${bold('NEXT')}${plain(' end')}</w:p>`
    )
  );
  try {
    await runtime.run(async (context) => {
      const first = context.document.body
        .search('TEST')
        .getFirst()
        .insertText('LONG FIRST', 'Replace');
      const second = context.document.body.search('NEXT').getFirst().insertText('X', 'Replace');
      await context.sync();
      first.load('text');
      second.load('text');
      first.font.load('bold');
      second.font.load('bold');
      context.document.body.load('text');
      await context.sync();
      expect(first.text).toBe('LONG FIRST');
      expect(second.text).toBe('X');
      expect(first.font.bold).toBe(true);
      expect(second.font.bold).toBe(true);
      expect(context.document.body.text).toBe('one LONG FIRST two X end');
    });
  } finally {
    runtime.dispose();
  }
});

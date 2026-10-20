/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createServer } from '../../runtime/server.ts';
import { docx } from './support/documents.ts';

const STAMP = 'w:author="Ada" w:date="2026-03-01T10:00:00Z"';
const aligned = (id: number, value: string, text: string) =>
  `<w:p><w:pPr><w:jc w:val="${value}"/><w:pPrChange w:id="${id}" ${STAMP}><w:pPr/></w:pPrChange></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
// The first change writes the default alignment out, so it changes nothing.
const BODY = aligned(1, 'left', 'Plain') + aligned(2, 'center', 'Centered');

async function listed(bytes: Uint8Array): Promise<number> {
  const server = await createServer(bytes, { author: 'Reviewer' });
  try {
    return await server.run(async (context) => {
      const revisions = context.document.revisions;
      revisions.load('items');
      await context.sync();
      return revisions.items.length;
    });
  } finally {
    server.dispose();
  }
}

test('a property change that leaves the formatting unchanged is not a listed revision', async () => {
  expect(await listed(docx(BODY))).toBe(1);
});

for (const action of ['acceptAll', 'rejectAll'] as const) {
  test(`${action} also clears the unlisted property change`, async () => {
    const server = await createServer(docx(BODY), { author: 'Reviewer' });
    try {
      await server.run(async (context) => {
        context.document.revisions[action]();
        await context.sync();
      });
      const saved = new Uint8Array(await server.save());
      expect(strFromU8(unzipSync(saved)['word/document.xml']!)).not.toContain('pPrChange');
      expect(await listed(saved)).toBe(0);
    } finally {
      server.dispose();
    }
  });
}

test('a batch answer counts only the revisions a caller can list', async () => {
  const server = await createServer(docx(BODY + aligned(3, 'right', 'Right')), {
    author: 'Reviewer',
  });
  try {
    await server.run(async (context) => {
      const revisions = context.document.revisions;
      revisions.load('items');
      await context.sync();
      expect(revisions.items).toHaveLength(2);
      const result = revisions.resolve('accept', [revisions.items[0]!]);
      await context.sync();
      expect(result.value.remaining).toBe(1);
    });
  } finally {
    server.dispose();
  }
});

test('a tracked edit over another author’s unlisted property change refuses', async () => {
  const run =
    '<w:p><w:r><w:rPr><w:b w:val="0"/><w:rPrChange w:id="9" w:author="Grace" w:date="2026-03-01T10:00:00Z"><w:rPr/></w:rPrChange></w:rPr><w:t>Hidden words</w:t></w:r></w:p>';
  const server = await createServer(docx(run), { author: 'Reviewer' });
  try {
    const outcome = await server.run(async (context) => {
      context.document.revisions.load('items');
      const matches = context.document.body.search('Hidden', { matchCase: true });
      matches.load('items');
      await context.sync();
      const listed = context.document.revisions.items.length;
      context.document.changeTrackingMode = 'TrackMineOnly';
      matches.items[0]!.insertText('Shown', 'Replace');
      try {
        await context.sync();
        return { listed, error: null };
      } catch (error) {
        const { code, debugInfo } = error as {
          code: string;
          debugInfo?: { innerError?: { code?: string } };
        };
        const named = JSON.stringify(debugInfo).includes('no review card');
        return { listed, error: { code, inner: debugInfo?.innerError?.code, named } };
      }
    });
    expect(outcome).toEqual({
      listed: 0,
      error: {
        code: 'NotImplemented',
        inner: 'edit.tracked-foreign-revision-unsupported',
        // The refusal names the possibility, so a caller with nothing listed knows what to look for.
        named: true,
      },
    });
  } finally {
    server.dispose();
  }
});

test('a story-wide author change leaves the unlisted property change alone', async () => {
  const server = await createServer(docx(BODY), { author: 'Reviewer' });
  try {
    await server.run(async (context) => {
      context.document.revisions.setAuthor('Lin');
      await context.sync();
    });
    const xml = strFromU8(unzipSync(new Uint8Array(await server.save()))['word/document.xml']!);
    expect(xml.split('w:author="Lin"').length - 1).toBe(1);
    expect(xml).toContain('w:author="Ada"');
  } finally {
    server.dispose();
  }
});

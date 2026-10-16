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

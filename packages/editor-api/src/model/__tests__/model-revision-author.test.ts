/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createServer } from '../../runtime/server.ts';
import { docx, p } from './support/documents.ts';

/** The same package with `w:documentProtection` for tracked changes enforced. */
function protectedForTracking(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  files['word/settings.xml'] = strToU8(
    `<w:settings xmlns:w="${W}"><w:documentProtection w:edit="trackedChanges" w:enforcement="1"/></w:settings>`
  );
  files['word/_rels/document.xml.rels'] = strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>'
  );
  files['[Content_Types].xml'] = strToU8(
    strFromU8(files['[Content_Types].xml']!).replace(
      '</Types>',
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>'
    )
  );
  return zipSync(files);
}

const xml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']!);
const ins = (id: number, author: string) =>
  `<w:p><w:ins w:id="${id}" w:author="${author}" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Added${id}</w:t></w:r></w:ins></w:p>`;

test('an agent suggestion is reattributed to its reviewer and stays pending', async () => {
  const agent = await createServer(docx(p('Pay within 7 days.')), { author: 'AI' });
  let saved: Uint8Array;
  try {
    await agent.run(async (context) => {
      const matches = context.document.body.search('7 days', { matchCase: true });
      matches.load('items');
      await context.sync();
      context.document.changeTrackingMode = 'TrackMineOnly';
      matches.items[0]!.insertText('30 days', 'Replace');
      await context.sync();
    });
    await agent.run(async (context) => {
      const revisions = context.document.revisions;
      revisions.load('items');
      await context.sync();
      for (const revision of revisions.items) revision.load('author');
      await context.sync();
      const suggested = revisions.items.filter((revision) => revision.author === 'AI');
      expect(suggested).toHaveLength(2);

      const date = new Date('2026-10-08T09:30:00Z');
      const result = revisions.setAuthor('Ada Lovelace', suggested, { date });
      await context.sync();
      expect(result.value.skipped).toEqual([]);
      expect(result.value.updated.map((entry) => [entry.previousAuthor, entry.author])).toEqual([
        ['AI', 'Ada Lovelace'],
        ['AI', 'Ada Lovelace'],
      ]);

      // The same proxies still name their changes, now under the new author.
      for (const revision of suggested) revision.load(['author', 'date', 'type']);
      await context.sync();
      expect(suggested.map((revision) => revision.author)).toEqual([
        'Ada Lovelace',
        'Ada Lovelace',
      ]);
      expect(suggested.map((revision) => revision.date?.toISOString())).toEqual([
        date.toISOString(),
        date.toISOString(),
      ]);
      expect(suggested.map((revision) => revision.type).sort()).toEqual(['Delete', 'Insert']);
    });
    saved = await agent.save();
  } finally {
    agent.dispose();
  }

  expect(xml(saved)).not.toContain('w:author="AI"');
  const reopened = await createServer(saved);
  try {
    await reopened.run(async (context) => {
      const revisions = context.document.revisions;
      revisions.load('items');
      await context.sync();
      for (const revision of revisions.items) revision.load('author');
      await context.sync();
      expect(revisions.items.map((revision) => revision.author)).toEqual([
        'Ada Lovelace',
        'Ada Lovelace',
      ]);
      revisions.acceptAll();
      await context.sync();
      const body = context.document.body;
      body.load('text');
      await context.sync();
      expect(body.text).toBe('Pay within 30 days.');
    });
  } finally {
    reopened.dispose();
  }
});

test('omitted revisions select the whole story, structural rows included', async () => {
  const row =
    '<w:tbl><w:tr><w:trPr><w:ins w:id="20" w:author="AI"/></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>';
  const runtime = await createServer(docx(ins(1, 'AI') + ins(2, 'Grace') + row));
  try {
    await runtime.run(async (context) => {
      const result = context.document.revisions.setAuthor('Ada');
      await context.sync();
      expect(result.value.updated).toHaveLength(3);
      const none = context.document.revisions.setAuthor('Lin', []);
      await context.sync();
      expect(none.value).toEqual({ updated: [], skipped: [] });
    });
    expect(xml(await runtime.save()).match(/w:author="Ada"/g)).toHaveLength(3);
  } finally {
    runtime.dispose();
  }
});

test('an authors filter takes every change those authors made', async () => {
  const runtime = await createServer(docx(ins(1, 'AI') + ins(2, 'Grace') + ins(3, 'AI')));
  try {
    await runtime.run(async (context) => {
      const result = context.document.revisions.setAuthor('Ada', { authors: ['AI'] });
      await context.sync();
      expect(result.value.updated.map((entry) => entry.previousAuthor)).toEqual(['AI', 'AI']);
      const revisions = context.document.revisions;
      revisions.load('items');
      await context.sync();
      for (const selection of [{ authors: 'AI' }, { authors: [7] }, null])
        expect(() => revisions.setAuthor('Ada', selection as never)).toThrow(
          expect.objectContaining({ code: 'InvalidArgument' })
        );
    });
    expect(xml(await runtime.save()).match(/w:author="Ada"/g)).toHaveLength(2);
  } finally {
    runtime.dispose();
  }
});

test('invalid arguments refuse before queuing, and foreign objects fail validation', async () => {
  const runtime = await createServer(docx(ins(1, 'AI')));
  try {
    await runtime.run(async (context) => {
      const revisions = context.document.revisions;
      for (const call of [
        () => revisions.setAuthor(' '),
        () => revisions.setAuthor(7 as unknown as string),
        () => revisions.setAuthor('Ada', 'all' as never),
        () => revisions.setAuthor('Ada', undefined, { date: new Date('soon') }),
      ])
        expect(call).toThrow(expect.objectContaining({ code: 'InvalidArgument' }));
    });
    let foreign: unknown;
    await runtime.run(async (context) => {
      const revisions = context.document.revisions;
      revisions.load('items');
      await context.sync();
      foreign = revisions.items[0];
    });
    await runtime.run(async (context) => {
      expect(() => context.document.revisions.setAuthor('Ada', [foreign as never])).toThrow(
        expect.objectContaining({ code: 'InvalidArgument' })
      );
    });
    expect(xml(await runtime.save())).toContain('w:author="AI"');
  } finally {
    runtime.dispose();
  }
});

test('protection and a shared write batch refuse with stable codes', async () => {
  const locked = await createServer(protectedForTracking(docx(ins(1, 'AI'))));
  try {
    const refused = locked.run(async (context) => {
      context.document.revisions.setAuthor('Ada');
      await context.sync();
    });
    // The store refuses the transaction, as it does every write protection forbids.
    await expect(refused).rejects.toMatchObject({ code: 'GeneralException' });
  } finally {
    locked.dispose();
  }
  const runtime = await createServer(docx(ins(1, 'AI') + p('tail')));
  try {
    const shared = runtime.run(async (context) => {
      context.document.revisions.setAuthor('Ada');
      context.document.body.insertText('more', 'End');
      await context.sync();
    });
    await expect(shared).rejects.toMatchObject({ code: 'ConflictingChanges' });
    expect(xml(await runtime.save())).toContain('w:author="AI"');
  } finally {
    runtime.dispose();
  }
});

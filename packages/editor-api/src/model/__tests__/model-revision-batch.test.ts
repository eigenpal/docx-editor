/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { createServer } from '../../runtime/server.ts';
import { docx } from './support/documents.ts';

const ins = (id: number, author = 'Ada') =>
  `<w:p><w:ins w:id="${id}" w:author="${author}"><w:r><w:t>Added${id}</w:t></w:r></w:ins></w:p>`;
const row = (complete: boolean) =>
  '<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr><w:tr><w:trPr><w:ins w:id="20" w:author="Grace"/></w:trPr><w:tc>' +
  (complete ? '<w:tcPr><w:cellIns w:id="20" w:author="Grace"/></w:tcPr>' : '') +
  '<w:p><w:r><w:t>row text</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
const xml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']!);
for (const action of ['accept', 'reject'] as const) {
  test(`${action} batch resolves supported revisions and reports omitted structural records`, async () => {
    const runtime = await createServer(docx(ins(1) + row(false)));
    try {
      await runtime.run(async (context) => {
        const revisions = context.document.revisions;
        revisions.load('items');
        await context.sync();
        expect(revisions.items).toHaveLength(1);
        const result = revisions.resolve(action);
        expect(result.isLoaded).toBe(false);
        expect(() => result.value).toThrow();
        await context.sync();
        expect(result.value.resolved).toHaveLength(1);
        expect(result.value.skipped).toHaveLength(1);
        expect(result.value.skipped[0]).toMatchObject({
          reason: 'unsupported-revision',
          revision: { author: 'Grace' },
        });
        expect(result.value.remaining).toBe(1);
      });
      const saved = await runtime.save();
      expect(xml(saved)).toContain('w:author="Grace"');
      expect(xml(saved).includes('Added1')).toBe(action === 'accept');
      const reopened = await createServer(saved);
      try {
        await reopened.run(async (context) => {
          const result = context.document.revisions.resolve(action);
          await context.sync();
          expect(result.value.resolved).toEqual([]);
          expect(result.value.skipped).toHaveLength(1);
          expect(result.value.remaining).toBe(1);
        });
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
  test(`${action} batch selects objects once and reports stale targets without aliasing repeated IDs`, async () => {
    const runtime = await createServer(
      docx(
        ins(1) + '<w:p><w:r><w:t>separator</w:t></w:r></w:p>' + ins(1, 'Grace') + ins(3, 'Linus')
      )
    );
    try {
      await runtime.run(async (context) => {
        const revisions = context.document.revisions;
        revisions.load('items');
        await context.sync();
        expect(revisions.items).toHaveLength(3);
        const first = revisions.items[0]!;
        const result = revisions.resolve(action, [first, first]);
        await context.sync();
        expect(result.value.resolved).toHaveLength(1);
        expect(result.value.remaining).toBe(2);
        const stale = revisions.resolve(action, [first]);
        await context.sync();
        expect(stale.value.skipped[0]?.reason).toBe('unknown-revision');
        expect(stale.value.remaining).toBe(2);
      });
    } finally {
      runtime.dispose();
    }
  });
  test(`${action} batch includes complete rows absent from items`, async () => {
    const runtime = await createServer(docx(ins(1) + row(true)));
    try {
      await runtime.run(async (context) => {
        const result = context.document.revisions.resolve(action);
        await context.sync();
        expect(result.value.resolved).toHaveLength(2);
        expect(result.value.remaining).toBe(0);
        expect(result.value.skipped).toEqual([]);
      });
      expect(xml(await runtime.save()).includes('row text')).toBe(action === 'accept');
    } finally {
      runtime.dispose();
    }
  });
  test(`${action} empty batch preserves bytes and reports pending changes`, async () => {
    const runtime = await createServer(docx(ins(1)));
    try {
      const before = await runtime.save();
      await runtime.run(async (context) => {
        const result = context.document.revisions.resolve(action, []);
        await context.sync();
        expect(result.value).toEqual({ resolved: [], skipped: [], remaining: 1 });
      });
      expect(await runtime.save()).toEqual(before);
    } finally {
      runtime.dispose();
    }
  });
}

test('remaining reflects surviving decisions that regroup after a rejection', async () => {
  const runtime = await createServer(
    docx(
      '<w:p><w:del w:id="1" w:author="Ada"><w:r><w:delText>old</w:delText></w:r></w:del><w:ins w:id="2" w:author="Grace"><w:r><w:t>middle</w:t></w:r></w:ins><w:ins w:id="3" w:author="Ada"><w:r><w:t>new</w:t></w:r></w:ins></w:p>'
    )
  );
  try {
    await runtime.run(async (context) => {
      const revisions = context.document.revisions;
      revisions.load('items');
      await context.sync();
      for (const revision of revisions.items) revision.load('author');
      await context.sync();
      const result = revisions.resolve(
        'reject',
        revisions.items.filter((item) => item.author === 'Grace')
      );
      await context.sync();
      revisions.load('items');
      await context.sync();
      expect(result.value.remaining).toBe(revisions.items.length);
      expect(result.value.resolved).toHaveLength(1);
    });
  } finally {
    runtime.dispose();
  }
});

test('batch refuses other writes atomically and leaves its result unloaded', async () => {
  const runtime = await createServer(docx(ins(1)));
  try {
    const before = await runtime.save();
    await runtime.run(async (context) => {
      const result = context.document.revisions.resolve('accept');
      context.document.body.insertText('extra', 'End');
      await expect(context.sync()).rejects.toMatchObject({ code: 'ConflictingChanges' });
      expect(result.isLoaded).toBe(false);
    });
    expect(await runtime.save()).toEqual(before);
  } finally {
    runtime.dispose();
  }
});

test('batch rejects objects from another request context without changing either document', async () => {
  const source = await createServer(docx(ins(1)));
  const target = await createServer(docx(ins(2)));
  try {
    const before = await target.save();
    await source.run(async (sourceContext) => {
      const revisions = sourceContext.document.revisions;
      revisions.load('items');
      await sourceContext.sync();
      await target.run(async (context) => {
        const result = context.document.revisions.resolve('accept', revisions.items);
        await expect(context.sync()).rejects.toMatchObject({ code: 'InvalidArgument' });
        expect(result.isLoaded).toBe(false);
      });
      revisions.load('items');
      await sourceContext.sync();
      expect(revisions.items).toHaveLength(1);
    });
    expect(await target.save()).toEqual(before);
  } finally {
    source.dispose();
    target.dispose();
  }
});
